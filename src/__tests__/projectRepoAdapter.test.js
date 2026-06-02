import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createProjectRepoAdapter } from '../services/projectRepo';
import { _resetProjectDbForTests, openProjectDb } from '../services/projectRepo/indexeddb';

function makeMockProvider() {
  const calls = [];
  const files = new Map(); // key = `${branch}:${path}` -> { content, sha }
  const heads = new Map(); // branch -> latest commit sha (simulated)
  let shaCounter = 0;
  const nextSha = () => `sha-${++shaCounter}`;

  return {
    calls,
    files,
    heads,
    impl: {
      id: 'gitlab',
      async listRepos() { return []; },
      async getFile({ owner, repo, path, ref }) {
        calls.push({ op: 'getFile', owner, repo, path, ref });
        const f = files.get(`${ref}:${path}`);
        if (!f) throw new Error(`404 not found: ${ref}:${path}`);
        return f;
      },
      async putFile({ owner, repo, path, content, sha, message, branch }) {
        calls.push({ op: 'putFile', owner, repo, path, sha, message, branch });
        const newSha = nextSha();
        files.set(`${branch}:${path}`, { content, sha: newSha });
        // Every write advances the branch's HEAD commit.
        heads.set(branch, `commit-${newSha}`);
        return { sha: newSha };
      },
      async createBranch({ owner, repo, from, name }) {
        calls.push({ op: 'createBranch', owner, repo, from, name });
      },
      async createPullRequest({ owner, repo, from, to, title }) {
        calls.push({ op: 'createPullRequest', owner, repo, from, to, title });
        return { url: 'https://gitlab.example.com/pr/1', number: 1 };
      },
      async listTree() { return []; },
      async listCommits({ ref }) {
        calls.push({ op: 'listCommits', ref });
        const sha = heads.get(ref) ?? 'commit-initial';
        return [{ sha, message: 'm', author: 'a', date: 'd' }];
      },
      async health() { return { ok: true, rtt_ms: 1 }; },
    },
  };
}

function makeAdapter(provider) {
  return createProjectRepoAdapter({
    provider: provider.impl,
    source: {
      id: 'src-1',
      provider: 'gitlab',
      base_url: 'https://gitlab.example.com',
      repos: [{ owner: 'acme', repo: 'lab', branch: 'main' }],
    },
    branchStrategy: 'shared_repo_subdir',
    projectPath: 'projects/demo',
    browserInstanceId: 'bi-123',
  });
}

describe('ProjectRepoAdapter', () => {
  beforeEach(async () => {
    _resetProjectDbForTests();
    // Delete any leftover IDB database between tests.
    const db = await openProjectDb();
    await db.clear('drafts');
    await db.clear('pending_commits');
  });

  it('autosave: creates draft branch and writes overlay/layout/meta under draft-<uuid>', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', {
      overlay: 'version: 1',
      canvas_layout: '{}',
      meta: { name: 'demo' },
    });

    const branches = mock.calls.filter((c) => c.op === 'createBranch');
    expect(branches.length).toBe(1);
    expect(branches[0].name).toBe('draft-bi-123');
    expect(branches[0].from).toBe('main');

    const puts = mock.calls.filter((c) => c.op === 'putFile');
    expect(puts.length).toBe(4);
    for (const p of puts) {
      expect(p.branch).toBe('draft-bi-123');
    }
    expect(puts.map((p) => p.path).sort()).toEqual([
      'projects/demo/canvas_layout.json',
      'projects/demo/meta.json',
      'projects/demo/overlay.json',
      'projects/demo/topology.json',
    ]);

    // IDB mirror
    const db = await openProjectDb();
    const drafts = await db.getAll('drafts');
    expect(drafts.length).toBe(1);
    expect(drafts[0].projectId).toBe('proj-1');
    const pending = await db.getAll('pending_commits');
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].branch).toBe('draft-bi-123');
  });

  it('save: fast-forwards draft files onto main when no conflict', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    // Seed main with an existing overlay so we exercise the sha-aware update.
    mock.files.set('main:projects/demo/overlay.json', {
      content: 'old',
      sha: 'sha-main-0',
    });
    await adapter.autosave('proj-1', {
      overlay: 'new-overlay',
      canvas_layout: 'layout',
      meta: { name: 'demo' },
    });
    mock.calls.length = 0; // reset call log

    const res = await adapter.save('proj-1', 'manual save');
    expect(res.pr_url).toBeUndefined();

    const mainPuts = mock.calls.filter(
      (c) => c.op === 'putFile' && c.branch === 'main',
    );
    expect(mainPuts.length).toBe(4);
    const overlayPut = mainPuts.find((p) => p.path.endsWith('/overlay.json'));
    expect(overlayPut.sha).toBe('sha-main-0');
  });

  it('save: returns the main HEAD commit_sha after a fast-forward (deployable SHA)', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', {
      overlay: 'o',
      canvas_layout: 'l',
      meta: {},
      topology: '{"schema_version":"1.0"}',
    });

    const res = await adapter.save('proj-1', 'manual save');
    expect(res.pr_url).toBeUndefined();
    expect(res.commit_sha).toBeTruthy();
    // The returned SHA is the main branch HEAD the backend will check out.
    expect(res.commit_sha).toBe(mock.heads.get('main'));
  });

  it('save: falls back to createPullRequest on conflict error', async () => {
    const mock = makeMockProvider();
    // Wrap putFile so writes to main throw a conflict.
    const underlying = mock.impl.putFile.bind(mock.impl);
    mock.impl.putFile = async (opts) => {
      if (opts.branch === 'main' && opts.path.endsWith('/overlay.json')) {
        throw new Error('409 conflict: fast-forward not possible');
      }
      return underlying(opts);
    };
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', {
      overlay: 'x',
      canvas_layout: 'y',
      meta: {},
    });
    const res = await adapter.save('proj-1', 'save');
    expect(res.pr_url).toBe('https://gitlab.example.com/pr/1');
    // Changes are only on the draft branch (awaiting PR merge), so there is no
    // deployable main-branch commit SHA yet.
    expect(res.commit_sha).toBeUndefined();
    const prCalls = mock.calls.filter((c) => c.op === 'createPullRequest');
    expect(prCalls.length).toBe(1);
    expect(prCalls[0].from).toBe('draft-bi-123');
    expect(prCalls[0].to).toBe('main');
  });

  it('checkLockOwnership: owner when .lock matches browser_instance_id', async () => {
    const mock = makeMockProvider();
    mock.files.set('main:projects/demo/.lock', {
      content: JSON.stringify({
        editor_id: 'proj-1',
        browser_instance_id: 'bi-123',
        heartbeat_at: '2026-04-14T00:00:00Z',
      }),
      sha: 'sha-lock-0',
    });
    const adapter = makeAdapter(mock);
    const out = await adapter.checkLockOwnership('proj-1');
    expect(out).toBe('owner');
  });

  it('checkLockOwnership: lost + fires onOrphanedDraft when mismatch', async () => {
    const mock = makeMockProvider();
    mock.files.set('main:projects/demo/.lock', {
      content: JSON.stringify({
        editor_id: 'proj-1',
        browser_instance_id: 'other-bi',
        heartbeat_at: '2026-04-14T00:00:00Z',
      }),
      sha: 'sha-lock-0',
    });
    const adapter = makeAdapter(mock);
    const cb = vi.fn();
    adapter.onOrphanedDraft(cb);
    const out = await adapter.checkLockOwnership('proj-1');
    expect(out).toBe('lost');
    expect(cb).toHaveBeenCalledWith('draft-bi-123');
  });

  it('checkLockOwnership: free when no .lock present', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    const out = await adapter.checkLockOwnership('proj-1');
    expect(out).toBe('free');
  });

  it('autosave: writes topology.json from ProjectState.topology', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', {
      overlay: 'version: 1',
      canvas_layout: '{}',
      meta: { name: 'demo' },
      topology: '{"schema_version":"1.0"}',
    });
    const written = mock.files.get('draft-bi-123:projects/demo/topology.json');
    expect(written?.content).toBe('{"schema_version":"1.0"}');
  });

  it('autosave: writes topology.json at repo ROOT when projectPath is empty', async () => {
    const mock = makeMockProvider();
    const adapter = createProjectRepoAdapter({
      provider: mock.impl,
      source: { id: 'src-1', provider: 'gitlab', base_url: 'https://gitlab.example.com', repos: [{ owner: 'acme', repo: 'lab', branch: 'main' }] },
      branchStrategy: 'dedicated_repo',
      projectPath: '',
      browserInstanceId: 'bi-root',
    });
    await adapter.autosave('proj-root', { overlay: '', canvas_layout: '{}', meta: {}, topology: '{"schema_version":"1.0"}' });
    const written = mock.files.get('draft-bi-root:topology.json');
    expect(written?.content).toBe('{"schema_version":"1.0"}');
  });
});

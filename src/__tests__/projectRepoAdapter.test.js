import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { assetFromBytes } from '@/services/projectFiles';
import { createProjectRepoAdapter } from '../services/projectRepo';
import { _resetProjectDbForTests, openProjectDb } from '../services/projectRepo/indexeddb';

function makeMockProvider() {
  const calls = [];
  const files = new Map(); // key = `${branch}:${path}` -> { content, sha }
  const snapshots = new Map();
  const branches = new Set(['main']);
  const heads = new Map(); // branch -> latest commit sha (simulated)
  let shaCounter = 0;
  const nextSha = () => `sha-${++shaCounter}`;

  return {
    calls,
    files,
    heads,
    impl: {
      id: 'gitlab',
      async canWrite() { return true; },
      async listRepos() { return []; },
      async getFile({ owner, repo, path, ref }) {
        calls.push({ op: 'getFile', owner, repo, path, ref });
        const f = snapshots.has(ref) ? snapshots.get(ref).get(path) : files.get(`${ref}:${path}`);
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
        branches.add(name);
      },
      async createPullRequest({ owner, repo, from, to, title }) {
        calls.push({ op: 'createPullRequest', owner, repo, from, to, title });
        return { url: 'https://gitlab.example.com/pr/1', number: 1 };
      },
      async listTree() { return []; },
      async listCommits({ ref }) {
        calls.push({ op: 'listCommits', ref });
        if (!branches.has(ref) && ![...files.keys()].some(key => key.startsWith(`${ref}:`))) throw new Error('404 not found');
        const sha = heads.get(ref) ?? 'commit-initial';
        snapshots.set(sha, new Map([...files.entries()].filter(([key]) => key.startsWith(`${ref}:`))
          .map(([key, value]) => [key.slice(ref.length + 1), JSON.parse(JSON.stringify(value))])));
        return [{ sha, message: 'm', author: 'a', date: 'd' }];
      },
      async health() { return { ok: true, rtt_ms: 1 }; },
    },
  };
}

function makeAdapter(provider, options = {}) {
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
    ...options,
  });
}

describe('ProjectRepoAdapter', () => {
  it('pins one working revision for metadata and assets even when the branch advances during loading', async () => {
    const mock = makeMockProvider()
    const original = assetFromBytes(Uint8Array.of(0, 255))
    const changed = assetFromBytes(Uint8Array.of(128, 0))
    let head = 'original-revision'
    mock.impl.listCommits = vi.fn(async () => [{ sha: head }])
    mock.impl.getFileContent = vi.fn(async ({ path, ref }) => {
      if (path.endsWith('meta.json')) {
        head = 'advanced-revision'
        return { sha: 'meta', content: JSON.stringify({ ui_files: ['content/a.bin'], ui_binary_files: { 'content/a.bin': { encoding: 'base64', size: 2 } } }) }
      }
      if (path.endsWith('content/a.bin')) return { sha: 'asset', content: ref === 'original-revision' ? original : changed }
      throw new Error('404 not found')
    })
    const loaded = await makeAdapter(mock).load('binary')
    expect(loaded.files['content/a.bin'].content).toBe(original.content)
    expect(loaded.revision).toEqual({ branch: 'draft-bi-123', commit_sha: 'original-revision' })
    expect(mock.impl.listCommits).toHaveBeenCalledOnce()
    expect(mock.impl.getFileContent.mock.calls.every(([options]) => options.ref === 'original-revision')).toBe(true)
  })
  it('does not resurrect a missing authored asset from the base branch', async () => {
    const mock = makeMockProvider()
    mock.impl.listCommits = async () => [{ sha: 'working-revision' }]
    mock.impl.getFileContent = vi.fn(async ({ path, ref }) => {
      if (path.endsWith('meta.json')) return { content: '{"ui_files":["content/a.bin"]}', sha: 'meta' }
      if (ref === 'main' && path.endsWith('content/a.bin')) return { content: 'old asset', sha: 'old' }
      throw new Error('404 not found')
    })
    await expect(makeAdapter(mock).load('binary')).rejects.toThrow(/authored file is missing/i)
    expect(mock.impl.getFileContent.mock.calls.some(([options]) => options.ref === 'main')).toBe(false)
  })
  it('does not treat access denied as a missing working branch', async () => {
    const mock = makeMockProvider()
    mock.impl.listCommits = vi.fn(async () => { throw Object.assign(new Error('Repository not found'), { status: 401 }) })
    await expect(makeAdapter(mock).load('binary')).rejects.toMatchObject({ status: 401 })
    expect(mock.impl.listCommits).toHaveBeenCalledOnce()
  })

  it.each(['meta.json', 'overlay.json', 'canvas_layout.json', 'topology.json', '.lock'])('rejects authored %s before creating a branch or overwriting generated documents', async path => {
    const mock = makeMockProvider()
    await expect(makeAdapter(mock).autosave('bad', { overlay: '{}', canvas_layout: '{}', meta: {}, files: { [path]: '{}' } })).rejects.toThrow(/reserved/i)
    expect(mock.calls).toEqual([])
  })
  it.each(['[]', '{bad json', '{"ui_files":"content/a.bin"}'])('rejects malformed saved metadata rather than loading an empty project', async content => {
    const mock = makeMockProvider()
    mock.files.set('main:projects/demo/meta.json', { content, sha: 'metadata' })
    await expect(makeAdapter(mock).load('bad')).rejects.toThrow(/metadata|manifest/i)
  })

  it('roundtrips binary file metadata without duplicating its payload in meta.json', async () => {
    const mock = makeMockProvider()
    mock.impl.getFileContent = mock.impl.getFile
    const asset = assetFromBytes(new TextEncoder().encode('ASCII uploaded as a binary asset'), 'application/test')
    const state = { overlay: '{}', canvas_layout: '{}', meta: { name: 'assets' }, files: { 'content/a.bin': asset } }
    const adapter = makeAdapter(mock)
    await adapter.autosave('binary', state)
    const metadata = JSON.parse(mock.files.get('draft-bi-123:projects/demo/meta.json').content)
    expect(metadata.ui_binary_files['content/a.bin']).toEqual({ encoding: 'base64', size: asset.size, media_type: 'application/test' })
    expect(JSON.stringify(metadata)).not.toContain(asset.content)
    // A provider may identify printable UTF-8 bytes as text; metadata restores the upload format.
    mock.files.set('draft-bi-123:projects/demo/content/a.bin', { content: 'ASCII uploaded as a binary asset', sha: 'blob' })
    expect((await adapter.load('binary')).files).toEqual(state.files)
  })

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

  it('roundtrips authored files under the shared project directory', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', {
      overlay: '', canvas_layout: '{}', meta: { name: 'Demo' },
      files: { 'scenarios/content/main.yml': '- hosts: localhost', 'scripts/setup.sh': 'echo done' },
    });
    expect(mock.files.get('draft-bi-123:projects/demo/scenarios/content/main.yml').content).toBe('- hosts: localhost');
    expect(mock.files.has('draft-bi-123:scenarios/content/main.yml')).toBe(false);
    const restored = await makeAdapter(mock).load('proj-1');
    expect(restored.files).toEqual({ 'scenarios/content/main.yml': '- hosts: localhost', 'scripts/setup.sh': 'echo done' });
  });

  it('skips unchanged file writes on repeated saves and direct publication', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    const state = { overlay: 'new', canvas_layout: '{}', meta: {} };
    await adapter.autosave('proj-1', state);
    await adapter.publishDirect('proj-1', 'Publish');
    const before = mock.calls.filter(call => call.op === 'putFile').length;
    await adapter.autosave('proj-1', state);
    await adapter.publishDirect('proj-1', 'Publish');
    expect(mock.calls.filter(call => call.op === 'putFile').length).toBe(before);
  });

  it('save: pins the dedicated branch and never writes the base branch', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    mock.files.set('main:projects/demo/overlay.json', { content: 'old', sha: 'sha-main' });
    await adapter.autosave('proj-1', { overlay: 'new', canvas_layout: '{}', meta: {} });
    const result = await adapter.save('proj-1', 'save');
    expect(mock.calls.filter(c => c.op === 'putFile' && c.branch === 'main')).toEqual([]);
    expect(mock.files.get('main:projects/demo/overlay.json').content).toBe('old');
    expect(result).toEqual({ commit_sha: mock.heads.get('draft-bi-123'), branch: 'draft-bi-123' });
    expect(mock.calls.some(c => c.op === 'createPullRequest')).toBe(false);
  });

  it('proposeMerge: opens a PR explicitly while keeping the working revision deployable', async () => {
    const mock = makeMockProvider();
    const adapter = makeAdapter(mock);
    await adapter.autosave('proj-1', { overlay: 'new', canvas_layout: '{}', meta: {} });
    const saved = await adapter.save('proj-1', 'save');
    const result = await adapter.proposeMerge('proj-1', 'Review this project');
    expect(result.pr_url).toBe('https://gitlab.example.com/pr/1');
    expect(saved.commit_sha).toBe(mock.heads.get('draft-bi-123'));
    expect(mock.calls.find(c => c.op === 'createPullRequest')).toMatchObject({
      from: 'draft-bi-123', to: 'main', title: 'Review this project',
    });
    expect(mock.calls.some(c => c.op === 'putFile' && c.branch === 'main')).toBe(false);
  });

  it('autosave: reuses the existing working branch file SHA after a new editor session', async () => {
    const mock = makeMockProvider();
    const branch = 'range42-ui/project-1';
    mock.impl.createBranch = async () => { throw new Error('Branch already exists'); };
    mock.files.set(`${branch}:projects/demo/overlay.json`, { content: 'previous', sha: 'branch-sha' });
    const adapter = makeAdapter(mock, { workingBranch: branch });
    await adapter.autosave('proj-1', { overlay: 'next', canvas_layout: '{}', meta: {} });
    expect(mock.calls.find(c => c.op === 'putFile' && c.path.endsWith('/overlay.json')))
      .toMatchObject({ branch, sha: 'branch-sha' });
  });

  it('autosave: refuses to target the base branch directly', () => {
    expect(() => makeAdapter(makeMockProvider(), { workingBranch: 'main' })).toThrow(/dedicated|base/i);
  });

  it('save: fails when the working branch HEAD cannot be pinned', async () => {
    const mock = makeMockProvider();
    mock.impl.listCommits = async () => [];
    await expect(makeAdapter(mock).save('proj-1', 'save')).rejects.toThrow(/revision|HEAD/i);
  });

  it('autosave: refuses to write when repository permission is read-only', async () => {
    const mock = makeMockProvider();
    mock.impl.canWrite = async () => false;
    await expect(makeAdapter(mock).autosave('proj-1', { overlay: '', canvas_layout: '{}', meta: {} }))
      .rejects.toThrow(/write|permission/i);
    expect(mock.calls).toEqual([]);
  });

  it('autosave: surfaces file read failures instead of treating them as missing files', async () => {
    const mock = makeMockProvider();
    mock.impl.getFile = async () => { throw new Error('401 unauthorised'); };
    await expect(makeAdapter(mock).autosave('proj-1', { overlay: '', canvas_layout: '{}', meta: {} }))
      .rejects.toThrow('401');
    expect(mock.calls.some(c => c.op === 'putFile')).toBe(false);
  });

  it('heartbeat: writes its lock only on the dedicated branch', async () => {
    const mock = makeMockProvider();
    await makeAdapter(mock).heartbeat('proj-1');
    expect(mock.calls.find(c => c.op === 'putFile')).toMatchObject({ branch: 'draft-bi-123' });
  });

  it('checkLockOwnership: owner when .lock matches browser_instance_id', async () => {
    const mock = makeMockProvider();
    mock.files.set('draft-bi-123:projects/demo/.lock', {
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
    mock.files.set('draft-bi-123:projects/demo/.lock', {
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

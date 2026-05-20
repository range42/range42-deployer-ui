import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabProvider } from '../services/git/gitlab';
import { encodeContentBase64 } from '../services/git/encoding';

function makeFetch(handlers) {
  // handlers: Array<{ match: (url, init) => bool, response: Response | (url,init) => Response }>
  return vi.fn(async (url, init) => {
    for (const h of handlers) {
      if (h.match(url, init)) {
        const r = typeof h.response === 'function' ? h.response(url, init) : h.response;
        return r;
      }
    }
    throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GitLabProvider', () => {
  let fetchImpl;

  beforeEach(() => {
    fetchImpl = null;
  });

  it('getFile: URL-encodes project id + path, sends PRIVATE-TOKEN, decodes base64', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url ===
          'https://gitlab.example.com/api/v4/projects/acme%2Flab/repository/files/path%2Fto%2Ffile.yaml?ref=main',
        response: () =>
          jsonResponse({
            content: encodeContentBase64('body: ok'),
            blob_id: 'sha-1234',
            encoding: 'base64',
          }),
      },
    ]);
    const p = new GitLabProvider({
      baseUrl: 'https://gitlab.example.com/',
      token: 'glpat-xyz',
      fetchImpl,
    });
    const out = await p.getFile({
      owner: 'acme',
      repo: 'lab',
      path: 'path/to/file.yaml',
      ref: 'main',
    });
    expect(out).toEqual({ content: 'body: ok', sha: 'sha-1234' });

    // Verify headers include PRIVATE-TOKEN
    const call = fetchImpl.mock.calls[0];
    expect(call[1].headers['PRIVATE-TOKEN']).toBe('glpat-xyz');
  });

  it('putFile: PUTs when sha present, base64-encodes content, follows with GET for new sha', async () => {
    let seenPut = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'PUT' &&
          url ===
            'https://gitlab.com/api/v4/projects/acme%2Flab/repository/files/range42.yaml',
        response: (_u, init) => {
          seenPut = JSON.parse(init.body);
          return jsonResponse({ file_path: 'range42.yaml', branch: 'draft-1' });
        },
      },
      {
        match: (url) =>
          url ===
          'https://gitlab.com/api/v4/projects/acme%2Flab/repository/files/range42.yaml?ref=draft-1',
        response: () =>
          jsonResponse({
            content: encodeContentBase64('new: content'),
            blob_id: 'sha-new',
            encoding: 'base64',
          }),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    const res = await p.putFile({
      owner: 'acme',
      repo: 'lab',
      path: 'range42.yaml',
      content: 'new: content',
      sha: 'sha-old',
      message: 'update',
      branch: 'draft-1',
    });
    expect(res).toEqual({ sha: 'sha-new' });
    expect(seenPut.branch).toBe('draft-1');
    expect(seenPut.encoding).toBe('base64');
    expect(seenPut.commit_message).toBe('update');
    expect(seenPut.last_commit_id).toBe('sha-old');
    expect(seenPut.content).toBe(encodeContentBase64('new: content'));
  });

  it('createBranch: POSTs to /repository/branches with branch + ref', async () => {
    let seen = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'POST' &&
          url === 'https://gitlab.com/api/v4/projects/acme%2Flab/repository/branches',
        response: (_u, init) => {
          seen = JSON.parse(init.body);
          return jsonResponse({ name: 'draft-a', commit: { id: 'abc' } });
        },
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    await p.createBranch({
      owner: 'acme',
      repo: 'lab',
      from: 'main',
      name: 'draft-a',
    });
    expect(seen).toEqual({ branch: 'draft-a', ref: 'main' });
  });

  it('createPullRequest: POSTs a merge request and returns web_url + iid', async () => {
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'POST' &&
          url === 'https://gitlab.com/api/v4/projects/acme%2Flab/merge_requests',
        response: () =>
          jsonResponse({
            web_url: 'https://gitlab.com/acme/lab/-/merge_requests/7',
            iid: 7,
          }),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    const res = await p.createPullRequest({
      owner: 'acme',
      repo: 'lab',
      from: 'draft-a',
      to: 'main',
      title: 'promote',
      body: 'desc',
    });
    expect(res).toEqual({
      url: 'https://gitlab.com/acme/lab/-/merge_requests/7',
      number: 7,
    });
  });

  it('listTree: requests recursive tree and maps type=tree to "tree" else "blob"', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url.startsWith(
            'https://gitlab.com/api/v4/projects/acme%2Flab/repository/tree?',
          ),
        response: () =>
          jsonResponse([
            { path: 'range42.yaml', type: 'blob', id: 'sha-a' },
            { path: 'catalog', type: 'tree', id: 'sha-b' },
          ]),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    const tree = await p.listTree({ owner: 'acme', repo: 'lab', ref: 'main' });
    expect(tree).toEqual([
      { path: 'range42.yaml', type: 'blob', sha: 'sha-a' },
      { path: 'catalog', type: 'tree', sha: 'sha-b' },
    ]);
  });

  it('listCommits: GETs /projects/:id/repository/commits with path+ref_name and maps to CommitRef', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url.startsWith(
            'https://gitlab.com/api/v4/projects/acme%2Flab/repository/commits?',
          ),
        response: (url) => {
          const u = new URL(url);
          expect(u.searchParams.get('ref_name')).toBe('main');
          expect(u.searchParams.get('path')).toBe('overlay.yaml');
          return jsonResponse([
            {
              id: 'abc123',
              message: 'initial',
              author_name: 'Alice',
              authored_date: '2026-04-01T10:00:00Z',
            },
            {
              id: 'def456',
              message: 'tweak',
              author_name: 'Bob',
              authored_date: '2026-04-02T10:00:00Z',
            },
          ]);
        },
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    const commits = await p.listCommits({
      owner: 'acme',
      repo: 'lab',
      path: 'overlay.yaml',
      ref: 'main',
    });
    expect(commits).toEqual([
      { sha: 'abc123', message: 'initial', author: 'Alice', date: '2026-04-01T10:00:00Z' },
      { sha: 'def456', message: 'tweak', author: 'Bob', date: '2026-04-02T10:00:00Z' },
    ]);
  });

  it('health: returns ok + rtt from /version', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://gitlab.com/api/v4/version',
        response: () => jsonResponse({ version: '17.0' }),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    const h = await p.health();
    expect(h.ok).toBe(true);
    expect(typeof h.rtt_ms).toBe('number');
  });

  it('canWrite: true when project_access access_level >= 30 (Developer)', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://gitlab.com/api/v4/projects/acme%2Flab',
        response: () =>
          jsonResponse({
            permissions: {
              project_access: { access_level: 30 },
              group_access: null,
            },
          }),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    expect(await p.canWrite('acme', 'lab')).toBe(true);
    expect(fetchImpl.mock.calls[0][1].headers['PRIVATE-TOKEN']).toBe('t');
  });

  it('canWrite: false when only Reporter access (access_level < 30)', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://gitlab.com/api/v4/projects/acme%2Flab',
        response: () =>
          jsonResponse({
            permissions: {
              project_access: { access_level: 20 },
              group_access: { access_level: 10 },
            },
          }),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    expect(await p.canWrite('acme', 'lab')).toBe(false);
  });

  it('canWrite: false without a token (no request made)', async () => {
    fetchImpl = makeFetch([]);
    const p = new GitLabProvider({ fetchImpl });
    expect(await p.canWrite('acme', 'lab')).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('canWrite: false on error response', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://gitlab.com/api/v4/projects/acme%2Flab',
        response: () => jsonResponse({ message: '404 Project Not Found' }, 404),
      },
    ]);
    const p = new GitLabProvider({ token: 't', fetchImpl });
    expect(await p.canWrite('acme', 'lab')).toBe(false);
  });
});

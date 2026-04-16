import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiteaProvider } from '../services/git/gitea';
import { encodeContentBase64 } from '../services/git/encoding';

function makeFetch(handlers) {
  return vi.fn(async (url, init) => {
    for (const h of handlers) {
      if (h.match(url, init)) {
        return typeof h.response === 'function' ? h.response(url, init) : h.response;
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

describe('GiteaProvider', () => {
  let fetchImpl;

  beforeEach(() => {
    fetchImpl = null;
  });

  it('getFile: URL uses owner/repo/contents path, sends token header, decodes base64', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url ===
          'https://gitea.example.com/api/v1/repos/acme/lab/contents/range42.yaml?ref=main',
        response: () =>
          jsonResponse({
            content: encodeContentBase64('body: ok'),
            sha: 'sha-1',
            encoding: 'base64',
          }),
      },
    ]);
    const p = new GiteaProvider({
      baseUrl: 'https://gitea.example.com/',
      token: 'pat-abc',
      fetchImpl,
    });
    const out = await p.getFile({
      owner: 'acme',
      repo: 'lab',
      path: 'range42.yaml',
      ref: 'main',
    });
    expect(out).toEqual({ content: 'body: ok', sha: 'sha-1' });
    expect(fetchImpl.mock.calls[0][1].headers['Authorization']).toBe('token pat-abc');
  });

  it('putFile: PUTs with base64 content + sha + message, returns new sha', async () => {
    let seen = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'PUT' &&
          url ===
            'https://gitea.com/api/v1/repos/acme/lab/contents/range42.yaml',
        response: (_u, init) => {
          seen = JSON.parse(init.body);
          return jsonResponse({ content: { sha: 'sha-new' } });
        },
      },
    ]);
    const p = new GiteaProvider({ token: 't', fetchImpl });
    const res = await p.putFile({
      owner: 'acme',
      repo: 'lab',
      path: 'range42.yaml',
      content: 'new: content',
      sha: 'sha-old',
      message: 'commit msg',
      branch: 'draft-x',
    });
    expect(res).toEqual({ sha: 'sha-new' });
    expect(seen.content).toBe(encodeContentBase64('new: content'));
    expect(seen.sha).toBe('sha-old');
    expect(seen.message).toBe('commit msg');
    expect(seen.branch).toBe('draft-x');
  });

  it('createBranch: POSTs new_branch_name + old_branch_name', async () => {
    let seen = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'POST' &&
          url === 'https://gitea.com/api/v1/repos/acme/lab/branches',
        response: (_u, init) => {
          seen = JSON.parse(init.body);
          return jsonResponse({ name: 'draft-a' });
        },
      },
    ]);
    const p = new GiteaProvider({ token: 't', fetchImpl });
    await p.createBranch({
      owner: 'acme',
      repo: 'lab',
      from: 'main',
      name: 'draft-a',
    });
    expect(seen).toEqual({ new_branch_name: 'draft-a', old_branch_name: 'main' });
  });

  it('createPullRequest: POSTs to /pulls and returns html_url + number', async () => {
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'POST' &&
          url === 'https://gitea.com/api/v1/repos/acme/lab/pulls',
        response: () =>
          jsonResponse({
            html_url: 'https://gitea.com/acme/lab/pulls/42',
            number: 42,
          }),
      },
    ]);
    const p = new GiteaProvider({ token: 't', fetchImpl });
    const res = await p.createPullRequest({
      owner: 'acme',
      repo: 'lab',
      from: 'draft-a',
      to: 'main',
      title: 'promote',
    });
    expect(res).toEqual({
      url: 'https://gitea.com/acme/lab/pulls/42',
      number: 42,
    });
  });

  it('listTree: GETs recursive tree, maps type, filters by path', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url ===
          'https://gitea.com/api/v1/repos/acme/lab/git/trees/main?recursive=true',
        response: () =>
          jsonResponse({
            tree: [
              { path: 'range42.yaml', type: 'blob', sha: 'a' },
              { path: 'catalog', type: 'tree', sha: 'b' },
              { path: 'catalog/vm.yaml', type: 'blob', sha: 'c' },
              { path: 'other/thing.yaml', type: 'blob', sha: 'd' },
            ],
          }),
      },
    ]);
    const p = new GiteaProvider({ token: 't', fetchImpl });
    const tree = await p.listTree({
      owner: 'acme',
      repo: 'lab',
      ref: 'main',
      path: 'catalog',
    });
    expect(tree).toEqual([
      { path: 'catalog', type: 'tree', sha: 'b' },
      { path: 'catalog/vm.yaml', type: 'blob', sha: 'c' },
    ]);
  });

  it('listCommits: GETs /repos/:owner/:repo/commits with path+sha and maps to CommitRef', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url.startsWith('https://gitea.com/api/v1/repos/acme/lab/commits?'),
        response: (url) => {
          const u = new URL(url);
          expect(u.searchParams.get('sha')).toBe('main');
          expect(u.searchParams.get('path')).toBe('overlay.yaml');
          return jsonResponse([
            {
              sha: 'sha-a',
              commit: {
                message: 'first',
                author: { name: 'Alice', date: '2026-04-01T00:00:00Z' },
              },
            },
          ]);
        },
      },
    ]);
    const p = new GiteaProvider({ baseUrl: 'https://gitea.com', token: 't', fetchImpl });
    const commits = await p.listCommits({
      owner: 'acme',
      repo: 'lab',
      path: 'overlay.yaml',
      ref: 'main',
    });
    expect(commits).toEqual([
      { sha: 'sha-a', message: 'first', author: 'Alice', date: '2026-04-01T00:00:00Z' },
    ]);
  });

  it('health: returns ok + rtt from /version', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://gitea.com/api/v1/version',
        response: () => jsonResponse({ version: '1.22.0' }),
      },
    ]);
    const p = new GiteaProvider({ token: 't', fetchImpl });
    const h = await p.health();
    expect(h.ok).toBe(true);
    expect(typeof h.rtt_ms).toBe('number');
  });
});

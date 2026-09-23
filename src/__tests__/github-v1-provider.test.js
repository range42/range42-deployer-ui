import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubV1Provider } from '../services/git/github.v1';
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

describe('GitHubV1Provider', () => {
  let fetchImpl;

  beforeEach(() => {
    fetchImpl = null;
  });

  it('has id "github"', () => {
    expect(new GitHubV1Provider().id).toBe('github');
  });

  it('maps github.com base_url to api.github.com and sends Bearer auth + vnd.github accept', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url ===
          'https://api.github.com/repos/acme/lab/contents/range42.yaml?ref=main',
        response: () =>
          jsonResponse({
            content: encodeContentBase64('body: ok'),
            sha: 'sha-1',
            encoding: 'base64',
          }),
      },
    ]);
    const p = new GitHubV1Provider({
      baseUrl: 'https://github.com',
      token: 'pat-abc',
      fetchImpl,
    });
    const out = await p.getFile({ owner: 'acme', repo: 'lab', path: 'range42.yaml', ref: 'main' });
    expect(out).toEqual({ content: 'body: ok', sha: 'sha-1' });
    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer pat-abc');
    expect(headers['Accept']).toBe('application/vnd.github+json');
  });

  it('uses api.github.com by default (no base_url) and unauthenticated when no token', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url === 'https://api.github.com/repos/acme/lab/contents/x.yaml?ref=main',
        response: () => jsonResponse({ content: encodeContentBase64('y: 1'), sha: 's', encoding: 'base64' }),
      },
    ]);
    const p = new GitHubV1Provider({ fetchImpl });
    await p.getFile({ owner: 'acme', repo: 'lab', path: 'x.yaml' });
    expect(fetchImpl.mock.calls[0][1].headers['Authorization']).toBeUndefined();
  });

  it('maps a GitHub Enterprise Server base_url to /api/v3', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url === 'https://ghe.corp.example/api/v3/repos/acme/lab/contents/x.yaml?ref=main',
        response: () => jsonResponse({ content: encodeContentBase64('z: 2'), sha: 's2', encoding: 'base64' }),
      },
    ]);
    const p = new GitHubV1Provider({ baseUrl: 'https://ghe.corp.example/', token: 't', fetchImpl });
    const out = await p.getFile({ owner: 'acme', repo: 'lab', path: 'x.yaml' });
    expect(out.sha).toBe('s2');
  });

  it('putFile: PUTs base64 content + sha + message + branch, returns content sha', async () => {
    let seen = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'PUT' &&
          url === 'https://api.github.com/repos/acme/lab/contents/topology.json',
        response: (_u, init) => {
          seen = JSON.parse(init.body);
          return jsonResponse({ content: { sha: 'blob-new' }, commit: { sha: 'commit-new' } });
        },
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    const res = await p.putFile({
      owner: 'acme',
      repo: 'lab',
      path: 'topology.json',
      content: '{"a":1}',
      sha: 'blob-old',
      message: 'commit msg',
      branch: 'draft-x',
    });
    expect(res).toEqual({ sha: 'blob-new' });
    expect(seen.content).toBe(encodeContentBase64('{"a":1}'));
    expect(seen.sha).toBe('blob-old');
    expect(seen.message).toBe('commit msg');
    expect(seen.branch).toBe('draft-x');
  });

  it('createBranch: resolves source ref SHA then POSTs refs/heads/<name>', async () => {
    let refsBody = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          (!init || init.method === undefined || init.method === 'GET') &&
          url === 'https://api.github.com/repos/acme/lab/git/ref/heads/main',
        response: () => jsonResponse({ object: { sha: 'main-sha' } }),
      },
      {
        match: (url, init) =>
          init?.method === 'POST' &&
          url === 'https://api.github.com/repos/acme/lab/git/refs',
        response: (_u, init) => {
          refsBody = JSON.parse(init.body);
          return jsonResponse({ ref: 'refs/heads/draft-a', object: { sha: 'main-sha' } });
        },
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    await p.createBranch({ owner: 'acme', repo: 'lab', from: 'main', name: 'draft-a' });
    expect(refsBody).toEqual({ ref: 'refs/heads/draft-a', sha: 'main-sha' });
  });

  it('createPullRequest: POSTs to /pulls and returns html_url + number', async () => {
    let seen = null;
    fetchImpl = makeFetch([
      {
        match: (url, init) =>
          init?.method === 'POST' && url === 'https://api.github.com/repos/acme/lab/pulls',
        response: (_u, init) => {
          seen = JSON.parse(init.body);
          return jsonResponse({ html_url: 'https://github.com/acme/lab/pull/7', number: 7 });
        },
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    const res = await p.createPullRequest({
      owner: 'acme',
      repo: 'lab',
      from: 'draft-a',
      to: 'main',
      title: 'promote',
      body: 'desc',
    });
    expect(res).toEqual({ url: 'https://github.com/acme/lab/pull/7', number: 7 });
    expect(seen).toEqual({ head: 'draft-a', base: 'main', title: 'promote', body: 'desc' });
  });

  it('listTree: GETs recursive tree, maps type, filters by path', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) =>
          url === 'https://api.github.com/repos/acme/lab/git/trees/main?recursive=true',
        response: () =>
          jsonResponse({
            tree: [
              { path: 'topology.json', type: 'blob', sha: 'a' },
              { path: 'catalog', type: 'tree', sha: 'b' },
              { path: 'catalog/vm.yaml', type: 'blob', sha: 'c' },
              { path: 'other/thing.yaml', type: 'blob', sha: 'd' },
            ],
          }),
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    const tree = await p.listTree({ owner: 'acme', repo: 'lab', ref: 'main', path: 'catalog' });
    expect(tree).toEqual([
      { path: 'catalog', type: 'tree', sha: 'b' },
      { path: 'catalog/vm.yaml', type: 'blob', sha: 'c' },
    ]);
  });

  it('listCommits: sends sha+path+per_page and maps to CommitRef (HEAD first)', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url.startsWith('https://api.github.com/repos/acme/lab/commits?'),
        response: (url) => {
          const u = new URL(url);
          expect(u.searchParams.get('sha')).toBe('main');
          expect(u.searchParams.get('path')).toBe('topology.json');
          expect(u.searchParams.get('per_page')).toBe('1');
          return jsonResponse([
            {
              sha: 'head-sha',
              commit: { message: 'latest', author: { name: 'Alice', date: '2026-05-01T00:00:00Z' } },
            },
          ]);
        },
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    const commits = await p.listCommits({
      owner: 'acme',
      repo: 'lab',
      path: 'topology.json',
      ref: 'main',
      perPage: 1,
    });
    expect(commits).toEqual([
      { sha: 'head-sha', message: 'latest', author: 'Alice', date: '2026-05-01T00:00:00Z' },
    ]);
  });

  it('canWrite: true when permissions.push set; false (no request) without token', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://api.github.com/repos/acme/lab',
        response: () => jsonResponse({ permissions: { admin: false, push: true, pull: true } }),
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    expect(await p.canWrite('acme', 'lab')).toBe(true);

    const noTokenFetch = makeFetch([]);
    const p2 = new GitHubV1Provider({ fetchImpl: noTokenFetch });
    expect(await p2.canWrite('acme', 'lab')).toBe(false);
    expect(noTokenFetch).not.toHaveBeenCalled();
  });

  it('health: ok + numeric rtt from /rate_limit', async () => {
    fetchImpl = makeFetch([
      {
        match: (url) => url === 'https://api.github.com/rate_limit',
        response: () => jsonResponse({ rate: { remaining: 5000 } }),
      },
    ]);
    const p = new GitHubV1Provider({ token: 't', fetchImpl });
    const h = await p.health();
    expect(h.ok).toBe(true);
    expect(typeof h.rtt_ms).toBe('number');
  });
});

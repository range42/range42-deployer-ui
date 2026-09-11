import { describe, it, expect, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'

const providers = [
  ['github', GitHubV1Provider, 'https://api.github.com', '/repos/up/catalog', '/repos/me/catalog'],
  ['gitlab', GitLabProvider, 'https://git.example/api/v4', '/projects/up%2Fcatalog', '/projects/me%2Fcatalog'],
  ['gitea', GiteaProvider, 'https://git.example/api/v1', '/repos/up/catalog', '/repos/me/catalog'],
]
function repo(kind, fork = false, parentId = 1) {
  return kind === 'gitlab'
    ? { id: fork ? 2 : 1, path: 'catalog', namespace: { full_path: fork ? 'me' : 'up' }, default_branch: 'main',
      forked_from_project: fork ? { id: parentId } : undefined, import_status: 'finished',
      permissions: { project_access: { access_level: fork ? 40 : 10 } } }
    : { id: fork ? 2 : 1, name: 'catalog', owner: { login: fork ? 'me' : 'up' }, default_branch: 'main',
      parent: fork ? { id: parentId } : undefined, permissions: { push: fork }, fork }
}
function setup(kind, Provider, base, upstream, personal, { exists = false, parentId = 1, denied = false } = {}) {
  let created = exists
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const path = url.slice(base.length)
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
    if (path === '/user') return reply({ login: 'me', username: 'me' })
    if (path === upstream) return reply(repo(kind))
    if (path === personal) return created ? reply(repo(kind, true, parentId)) : reply({}, 404)
    if (path === `${upstream}/${kind === 'gitlab' ? 'fork' : 'forks'}` && init.method === 'POST') {
      if (denied) return reply({ message: 'Forking disabled' }, 403)
      created = true
      return reply(repo(kind, true), 202)
    }
    throw Error(`Unexpected ${init.method || 'GET'} ${url}`)
  })
  return { provider: new Provider({ baseUrl: kind === 'github' ? 'https://github.com' : 'https://git.example', token: 'pat', fetchImpl }), fetchImpl }
}

describe.each(providers)('%s personal contribution forks', (kind, Provider, base, upstream, personal) => {
  it('reports a fork that is still being prepared as retryable', async () => {
    let creating = false
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const path = url.slice(base.length)
      if (path === '/user') return new Response(JSON.stringify({ login: 'me', username: 'me' }))
      if (path === upstream) return new Response(JSON.stringify(repo(kind)))
      if (path === personal) return new Response(JSON.stringify({ message: creating ? 'Still preparing' : 'Not found' }), { status: 404 })
      if (init.method === 'POST') { creating = true; return new Response(JSON.stringify(repo(kind, true)), { status: 202 }) }
      throw Error('Unexpected request')
    })
    const provider = new Provider({ baseUrl: kind === 'github' ? 'https://github.com' : 'https://git.example', token: 'pat', fetchImpl })
    await expect(provider.ensureFork({ owner: 'up', repo: 'catalog' })).rejects.toThrow(/preparing.*retry|retry.*prepar/i)
  })
  it('creates a contribution branch at the selected upstream commit', async () => {
    const sha = 'a'.repeat(40)
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }))
    const provider = new Provider({ baseUrl: kind === 'github' ? 'https://github.com' : 'https://git.example', token: 'pat', fetchImpl })
    await provider.createBranch({ owner: 'me', repo: 'catalog', from: sha, name: 'contribution' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject(kind === 'github'
      ? { sha, ref: 'refs/heads/contribution' } : kind === 'gitlab'
        ? { ref: sha, branch: 'contribution' } : { old_ref_name: sha, new_branch_name: 'contribution' })
  })
  it('creates an organization fork only in the selected namespace and verifies its parent', async () => {
    const destination = kind === 'gitlab' ? 'company/training' : 'company'
    let created = false
    const fork = repo(kind, true)
    if (kind === 'gitlab') fork.namespace.full_path = destination
    else fork.owner.login = destination
    const destinationPath = kind === 'gitlab' ? `/projects/${encodeURIComponent(`${destination}/catalog`)}` : `/repos/${destination}/catalog`
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const path = url.slice(base.length)
      if (path === '/user') return new Response(JSON.stringify({ login: 'me', username: 'me' }))
      if (path === upstream) return new Response(JSON.stringify(repo(kind)))
      if (path === destinationPath) return new Response(JSON.stringify(created ? fork : {}), { status: created ? 200 : 404 })
      if (init.method === 'POST') { created = true; return new Response(JSON.stringify(fork), { status: 202 }) }
      return new Response('{}', { status: 404 })
    })
    const provider = new Provider({ baseUrl: kind === 'github' ? 'https://github.com' : 'https://git.example', token: 'pat', fetchImpl })
    expect(await provider.ensureFork({ owner: 'up', repo: 'catalog', destination })).toMatchObject({ owner: destination, repo: 'catalog' })
    const [, init] = fetchImpl.mock.calls.find(([, init]) => init.method === 'POST')
    expect(JSON.parse(init.body)).toMatchObject(kind === 'gitlab' ? { namespace_path: destination } : { organization: destination })
  })

  it('creates an authenticated personal fork and verifies its upstream relationship', async () => {
    const { provider, fetchImpl } = setup(kind, Provider, base, upstream, personal)
    expect(await provider.ensureFork({ owner: 'up', repo: 'catalog' })).toMatchObject({ owner: 'me', repo: 'catalog' })
    expect(fetchImpl.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })
  it('reuses a verified existing fork without creating another repository', async () => {
    const { provider, fetchImpl } = setup(kind, Provider, base, upstream, personal, { exists: true })
    expect(await provider.ensureFork({ owner: 'up', repo: 'catalog' })).toMatchObject({ owner: 'me', repo: 'catalog' })
    expect(fetchImpl.mock.calls.every(([, init]) => init.method !== 'POST')).toBe(true)
  })
  it('rejects an unrelated same-named personal repository before any write', async () => {
    const { provider, fetchImpl } = setup(kind, Provider, base, upstream, personal, { exists: true, parentId: 999 })
    await expect(provider.ensureFork({ owner: 'up', repo: 'catalog' })).rejects.toThrow(/unrelated|fork.*upstream/i)
    expect(fetchImpl.mock.calls.every(([, init]) => init.method !== 'POST')).toBe(true)
  })
  it('preserves a provider refusal to create a fork', async () => {
    const { provider } = setup(kind, Provider, base, upstream, personal, { denied: true })
    await expect(provider.ensureFork({ owner: 'up', repo: 'catalog' })).rejects.toThrow(/403/)
  })
  it('opens the review against upstream with the fork as source', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (kind === 'gitlab' && init.method !== 'POST') return new Response(JSON.stringify({ id: 42 }))
      return new Response(JSON.stringify({ html_url: 'https://git.example/pr/1', number: 1, web_url: 'https://git.example/mr/1', iid: 1 }))
    })
    const provider = new Provider({ baseUrl: kind === 'github' ? 'https://github.com' : 'https://git.example', token: 'pat', fetchImpl })
    await provider.createPullRequest({ owner: 'up', repo: 'catalog', source: { owner: 'me', repo: 'catalog' }, from: 'work', to: 'release', title: 'Add role' })
    const [url, init] = fetchImpl.mock.calls.find(([, init]) => init.method === 'POST')
    const body = JSON.parse(init.body)
    expect(url).toBe(`${base}${kind === 'gitlab' ? personal + '/merge_requests' : upstream + '/pulls'}`)
    expect(body).toMatchObject(kind === 'gitlab'
      ? { target_project_id: 42, source_branch: 'work', target_branch: 'release' }
      : { head: 'me:work', base: 'release' })
  })
})

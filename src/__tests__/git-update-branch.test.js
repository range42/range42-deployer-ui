import { describe, expect, it, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'
const head = 'a'.repeat(40)
const upstream = 'b'.repeat(40)
const ref = { owner: 'up', repo: 'catalog', number: 7, expectedHead: head }
const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status })

describe.each([['github', GitHubV1Provider], ['gitea', GiteaProvider]])('%s contribution branch updates', (kind, Provider) => {
  function setup({ conflict = false, changed = false } = {}) {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (init.method && init.method !== 'GET') return conflict ? reply({ message: 'Merge conflict' }, 409) : reply(null, kind === 'github' ? 202 : 200)
      if (url.endsWith('/pulls/7')) return reply({ number: 7, state: 'open', head: { sha: changed ? upstream : head }, mergeable: true, mergeable_state: 'clean' })
      return reply({ permissions: { push: true } })
    })
    return { provider: new Provider({ baseUrl: 'https://git.test', token: 'test', fetchImpl }), fetchImpl }
  }
  it('merges upstream into the contribution branch without rewriting history', async () => {
    const { provider, fetchImpl } = setup()
    expect(await provider.updatePullRequestBranch(ref)).toMatchObject({ status: kind === 'github' ? 'queued' : 'updated' })
    const [url, init] = fetchImpl.mock.calls.find(([, init]) => init.method && init.method !== 'GET')
    expect(url).toMatch(kind === 'github' ? /\/pulls\/7\/update-branch$/ : /\/pulls\/7\/update\?style=merge$/)
    expect(init.method).toBe(kind === 'github' ? 'PUT' : 'POST')
    if (kind === 'github') expect(JSON.parse(init.body)).toEqual({ expected_head_sha: head })
    expect(init.body || '').not.toContain('force')
  })
  it('preserves merge conflicts as actionable failures', async () => {
    const { provider } = setup({ conflict: true })
    await expect(provider.updatePullRequestBranch(ref)).rejects.toThrow(/conflict/i)
  })
  it('rejects a head changed since review before making a write', async () => {
    const { provider, fetchImpl } = setup({ changed: true })
    await expect(provider.updatePullRequestBranch(ref)).rejects.toThrow(/changed/i)
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true)
  })
})

describe('GitLab contribution synchronization', () => {
  it('creates a review inside the writable fork and never rebases or merges automatically', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (url.endsWith('/projects/up%2Fcatalog/merge_requests/7')) return reply({ iid: 7, state: 'opened', sha: head, source_project_id: 2, source_branch: 'contribution', target_branch: 'main', user: { can_merge: false }, detailed_merge_status: 'not_approved' })
      if (url.endsWith('/projects/2')) return reply({ path: 'catalog', namespace: { full_path: 'me' } })
      if (url.endsWith('/projects/me%2Fcatalog')) return reply({ id: 2, permissions: { project_access: { access_level: 40 } } })
      if (url.includes('/repository/commits?')) return reply([{ id: upstream }])
      if (url.endsWith('/projects/up%2Fcatalog/merge_requests')) return reply({ iid: 8, web_url: 'https://git.test/me/catalog/-/merge_requests/8' }, 201)
      throw new Error(`Unexpected ${init.method || 'GET'} ${url}`)
    })
    const provider = new GitLabProvider({ baseUrl: 'https://git.test', token: 'test', fetchImpl })
    expect(await provider.updatePullRequestBranch(ref)).toEqual({ status: 'review_required', review_url: 'https://git.test/me/catalog/-/merge_requests/8' })
    const writes = fetchImpl.mock.calls.filter(([, init]) => init.method && init.method !== 'GET')
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toContain('/projects/up%2Fcatalog/merge_requests')
    expect(JSON.parse(writes[0][1].body)).toMatchObject({ source_branch: 'main', target_project_id: 2, target_branch: 'contribution' })
    expect(writes.some(([url]) => url.includes('/repository/branches'))).toBe(false)
    expect(writes.some(([url]) => /\/(rebase|merge)$/.test(url))).toBe(false)
  })
})

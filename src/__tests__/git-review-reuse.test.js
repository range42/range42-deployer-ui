import { describe, expect, it, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GiteaProvider } from '@/services/git/gitea'
import { GitLabProvider } from '@/services/git/gitlab'
const opts = { owner: 'up', repo: 'catalog', from: 'contribution', to: 'main', title: 'Saved changes', source: { owner: 'me', repo: 'catalog-fork' } }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })

describe.each([['github', GitHubV1Provider], ['gitea', GiteaProvider]])('%s existing reviews', (kind, Provider) => {
  function setup({ wrongSource = false, status = 422 } = {}) {
    const fetchImpl = vi.fn(async (_url, init = {}) => {
      if (init.method === 'POST') return reply({ message: 'Pull request already exists' }, status)
      return reply([{ number: 8, html_url: 'https://git.test/up/catalog/pulls/8', state: 'open', head: { ref: opts.from, repo: { owner: { login: 'me' }, name: wrongSource ? 'another-fork' : 'catalog-fork' } }, base: { ref: 'main' } }])
    })
    return { provider: new Provider({ baseUrl: 'https://git.test', token: 'test', fetchImpl }), fetchImpl }
  }
  it('reuses the open review after republishing to the same fork branch', async () => {
    const { provider } = setup()
    expect(await provider.createPullRequest(opts)).toEqual({ number: 8, url: 'https://git.test/up/catalog/pulls/8' })
  })
  it('never adopts a review from a different source repository', async () => {
    const { provider } = setup({ wrongSource: true })
    await expect(provider.createPullRequest(opts)).rejects.toThrow(/422/)
  })
  it('preserves permission errors without attempting review lookup', async () => {
    const { provider, fetchImpl } = setup({ status: 403 })
    await expect(provider.createPullRequest(opts)).rejects.toThrow(/403/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('GitLab existing merge requests', () => {
  function setup(wrongSource = false) {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') return reply({ message: 'Merge request already exists' }, 409)
      if (url.endsWith('/projects/up%2Fcatalog')) return reply({ id: 1 })
      if (url.endsWith('/projects/me%2Fcatalog-fork')) return reply({ id: 2 })
      if (url.includes('/merge_requests?')) return reply([{ iid: 8, web_url: 'https://git.test/up/catalog/-/merge_requests/8', state: 'opened', source_project_id: wrongSource ? 3 : 2, source_branch: 'contribution', target_branch: 'main' }])
      throw new Error(`Unexpected ${url}`)
    })
    return new GitLabProvider({ baseUrl: 'https://git.test', token: 'test', fetchImpl })
  }
  it('reuses the exact source project and branch after republishing', async () => {
    expect(await setup().createPullRequest(opts)).toEqual({ number: 8, url: 'https://git.test/up/catalog/-/merge_requests/8' })
  })
  it('never adopts another fork with the same branch name', async () => {
    await expect(setup(true).createPullRequest(opts)).rejects.toThrow(/409/)
  })
})

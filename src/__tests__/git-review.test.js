import { describe, it, expect, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'

const head = 'a'.repeat(40)
const ref = { owner: 'up', repo: 'catalog', number: 7 }
const providers = [['github', GitHubV1Provider], ['gitlab', GitLabProvider], ['gitea', GiteaProvider]]
function fixture(kind, Provider, { canMerge = true, mergeable = true, actualHead = head, rejectMerge = false } = {}) {
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const response = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status })
    if (method !== 'GET') {
      if (rejectMerge) return response({ message: 'Required approval missing' }, 403)
      return response(kind === 'gitea' ? null : kind === 'gitlab' ? { state: 'merged', merge_commit_sha: 'merged' } : { merged: true, sha: 'merged' })
    }
    if (/\/(pulls|merge_requests)\/7/.test(url)) return response(kind === 'gitlab'
      ? { iid: 7, web_url: 'https://git.test/pr/7', state: 'opened', sha: actualHead, user: { can_merge: canMerge }, detailed_merge_status: mergeable ? 'mergeable' : 'not_approved', draft: false }
      : { number: 7, html_url: 'https://git.test/pr/7', state: 'open', head: { sha: actualHead }, mergeable, mergeable_state: mergeable ? 'clean' : 'blocked', draft: false })
    return response({ permissions: { push: canMerge } })
  })
  return { provider: new Provider({ baseUrl: 'https://git.test', token: 'pat', fetchImpl }), fetchImpl }
}

describe.each(providers)('%s review and merge', (kind, Provider) => {
  it('reads live review permissions without writing', async () => {
    const { provider, fetchImpl } = fixture(kind, Provider)
    expect(await provider.getPullRequest(ref)).toMatchObject({ number: 7, head_sha: head, can_merge: true, mergeable: true, state: 'open' })
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true)
  })
  it('merges only the reviewed head and retains the working branch', async () => {
    const { provider, fetchImpl } = fixture(kind, Provider)
    expect(await provider.mergePullRequest({ ...ref, expectedHead: head })).toMatchObject({ merged: true })
    const [url, init] = fetchImpl.mock.calls.find(([, init]) => init.method && init.method !== 'GET')
    expect(url).toMatch(/\/(pulls|merge_requests)\/7\/merge$/)
    expect(init.method).toBe(kind === 'gitea' ? 'POST' : 'PUT')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject(kind === 'gitea' ? { head_commit_id: head, force_merge: false, delete_branch_after_merge: false } : kind === 'gitlab' ? { sha: head, should_remove_source_branch: false } : { sha: head })
  })
  it.each([{ canMerge: false }, { mergeable: false }, { actualHead: 'b'.repeat(40) }])('refuses a blocked or changed review before any write: %j', async options => {
    const { provider, fetchImpl } = fixture(kind, Provider, options)
    await expect(provider.mergePullRequest({ ...ref, expectedHead: head })).rejects.toThrow(/permission|merge|changed/i)
    expect(fetchImpl.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true)
  })
  it('keeps provider approval failures visible without claiming a successful merge', async () => {
    const { provider } = fixture(kind, Provider, { rejectMerge: true })
    await expect(provider.mergePullRequest({ ...ref, expectedHead: head })).rejects.toThrow(/403|approval/i)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
describe('complete repository tree metadata', () => {
  it.each([GitHubV1Provider, GiteaProvider])('retains symlink modes and rejects a truncated tree', async Provider => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply({ tree: [{ path: 'role/link', type: 'blob', mode: '120000', sha: 'blob' }] }))
      .mockResolvedValueOnce(reply({ tree: [], truncated: true }))
    const provider = new Provider({ fetchImpl })
    expect((await provider.listTree({ owner: 'me', repo: 'r' }))[0].mode).toBe('120000')
    await expect(provider.listTree({ owner: 'me', repo: 'r' })).rejects.toThrow(/truncated/i)
  })
  it('reads every GitLab page at one immutable ref including modes', async () => {
    const fetchImpl = vi.fn(async (url: string) => reply(new URL(url).searchParams.get('page') === '2'
      ? [{ path: 'role/last', type: 'blob', id: 'last', mode: '100644' }]
      : Array.from({ length: 100 }, (_, index) => ({ path: `role/${index}`, type: 'blob', id: `${index}`, mode: '100644' }))))
    const provider = new GitLabProvider({ fetchImpl })
    const tree = await provider.listTree({ owner: 'me', repo: 'r', ref: 'a'.repeat(40), path: 'role' })
    expect(tree).toHaveLength(101)
    expect(tree[100]).toMatchObject({ path: 'role/last', mode: '100644' })
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).searchParams.get('ref') === 'a'.repeat(40))).toBe(true)
  })
})

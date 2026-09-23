import { describe, it, expect, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })

describe('provider final-write editor fence', () => {
  it('refuses GitHub ref publication after retirement during commit-object creation', async () => {
    let current = true
    const fetchImpl = vi.fn(async (url, _init) => {
      if (url.endsWith('/commits/base')) return json({ tree: { sha: 'tree' } })
      if (url.includes('/trees/tree?')) return json({ tree: [] })
      if (url.endsWith('/trees')) return json({ sha: 'new-tree' })
      if (url.endsWith('/commits')) { current = false; return json({ sha: 'new-commit' }) }
      return json({ object: { sha: 'new-commit' } })
    })
    const provider = new GitHubV1Provider({ fetchImpl })
    await expect(provider.commitFiles({ owner: 'owner', repo: 'repo', branch: 'work', expectedHead: 'base', message: 'save', files: [{ path: 'file', content: 'new' }],
      assertCurrent: () => { if (!current) throw new Error('Editor closed') },
    })).rejects.toThrow('Editor closed')
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('refuses GitLab atomic commit after retirement during metadata reads', async () => {
    let current = true
    const fetchImpl = vi.fn(async (_url, init) => {
      if (!init?.method) { current = false; return json({ blob_id: 'blob', last_commit_id: 'last' }) }
      return json({ id: 'commit' })
    })
    const provider = new GitLabProvider({ fetchImpl })
    await expect(provider.commitFiles({ owner: 'owner', repo: 'repo', branch: 'work', expectedHead: 'base', message: 'save', files: [{ path: 'file', content: 'new', sha: 'blob' }],
      assertCurrent: () => { if (!current) throw new Error('Editor closed') },
    })).rejects.toThrow('Editor closed')
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('refuses Gitea before its single atomic request when the editor is closed', async () => {
    const fetchImpl = vi.fn(async () => json({ commit: { sha: 'new' } }))
    await expect(new GiteaProvider({ fetchImpl }).commitFiles({ owner: 'owner', repo: 'repo', branch: 'work', expectedHead: 'base', message: 'save', files: [{ path: 'file', content: 'new' }],
      assertCurrent: () => { throw new Error('Editor closed') },
    })).rejects.toThrow('Editor closed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses GitLab heartbeat after retirement during its SHA-to-commit lookup', async () => {
    let current = true
    const fetchImpl = vi.fn(async () => { current = false; return json({ blob_id: 'blob', last_commit_id: 'last' }) })
    await expect(new GitLabProvider({ fetchImpl }).putFile({ owner: 'owner', repo: 'repo', branch: 'work', message: 'heartbeat', path: '.lock', content: '{}', sha: 'blob',
      assertCurrent: () => { if (!current) throw new Error('Editor closed') },
    })).rejects.toThrow('Editor closed')
    expect(fetchImpl.mock.calls).toHaveLength(1)
  })

  it('refuses a fork merge request after retirement during target lookup', async () => {
    let current = true
    const fetchImpl = vi.fn(async (_url, init) => {
      if (!init?.method) { current = false; return json({ id: 9 }) }
      return json({ web_url: 'https://git.test/mr/1', iid: 1 })
    })
    await expect(new GitLabProvider({ fetchImpl }).createPullRequest({ owner: 'upstream', repo: 'repo', from: 'work', to: 'main', title: 'review', source: { owner: 'fork', repo: 'repo' },
      assertCurrent: () => { if (!current) throw new Error('Editor closed') },
    })).rejects.toThrow('Editor closed')
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
})

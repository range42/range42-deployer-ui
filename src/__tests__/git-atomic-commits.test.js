import { describe, it, expect, vi } from 'vitest'
import { GitHubV1Provider } from '@/services/git/github.v1'
import { GitLabProvider } from '@/services/git/gitlab'
import { GiteaProvider } from '@/services/git/gitea'
import { decodeContentBase64 } from '@/services/git/encoding'

const changes = [{ path: 'old.yml', content: 'updated', sha: 'old-blob' }, { path: 'new.yml', content: 'new' }]
const options = { owner: 'me', repo: 'catalog', branch: 'work', message: 'Two files', expectedHead: 'a'.repeat(40), files: changes }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })

describe('atomic provider commits', () => {
  it('preserves executable file modes when GitHub updates existing scripts', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (url.endsWith(`/git/commits/${options.expectedHead}`)) return reply({ tree: { sha: 'base-tree' } })
      if (url.includes('/git/trees/base-tree')) return reply({ tree: [{ path: 'old.yml', mode: '100755' }] })
      return reply(init.method === 'PATCH' ? { object: { sha: 'new' } } : { sha: 'new' })
    })
    await new GitHubV1Provider({ token: 'pat', fetchImpl }).commitFiles(options)
    const treeCall = fetchImpl.mock.calls.find(([url, init]) => url.endsWith('/git/trees') && init.method === 'POST')
    expect(JSON.parse(treeCall[1].body).tree[0].mode).toBe('100755')
  })
  it('publishes GitHub changes as one tree and commit with a non-forced branch update', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => {
      if (url.endsWith(`/git/commits/${options.expectedHead}`)) return reply({ tree: { sha: 'base-tree' } })
      if (url.includes('/git/trees/base-tree')) return reply({ tree: [] })
      if (url.endsWith('/git/trees')) return reply({ sha: 'new-tree' }, 201)
      if (url.endsWith('/git/commits')) return reply({ sha: 'new-commit' }, 201)
      if (init.method === 'PATCH') return reply({ object: { sha: 'new-commit' } })
      throw Error('Unexpected request')
    })
    const provider = new GitHubV1Provider({ token: 'pat', fetchImpl })
    expect(await provider.commitFiles(options)).toEqual({ sha: 'new-commit' })
    const bodies = fetchImpl.mock.calls.filter(([, init]) => init.method === 'POST' || init.method === 'PATCH').map(([, init]) => JSON.parse(init.body))
    expect(bodies[0]).toMatchObject({ base_tree: 'base-tree', tree: changes.map(file => ({ path: file.path, content: file.content })) })
    expect(bodies[1]).toMatchObject({ tree: 'new-tree', parents: [options.expectedHead] })
    expect(bodies[2]).toEqual({ sha: 'new-commit', force: false })
  })

  it('keeps GitHub branch unchanged when the final ref update rejects concurrent progress', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => init.method === 'PATCH' ? reply({ message: 'Not a fast forward' }, 422)
      : reply(url.includes(options.expectedHead) ? { tree: { sha: 'base' } } : url.includes('/git/trees/base') ? { tree: [] } : { sha: 'new' }))
    const provider = new GitHubV1Provider({ token: 'pat', fetchImpl })
    await expect(provider.commitFiles(options)).rejects.toThrow(/422/)
    expect(fetchImpl.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1)
    expect(JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).force).toBe(false)
  })

  it('uses one GitLab commit with per-file last-commit guards from the captured revision', async () => {
    const fetchImpl = vi.fn(async (url, init = {}) => init.method === 'POST' ? reply({ id: 'new-commit' }, 201)
      : reply({ blob_id: 'old-blob', last_commit_id: 'file-commit' }))
    const provider = new GitLabProvider({ token: 'pat', fetchImpl })
    expect(await provider.commitFiles(options)).toEqual({ sha: 'new-commit' })
    expect(fetchImpl.mock.calls[0][0]).toContain(`?ref=${options.expectedHead}`)
    const body = JSON.parse(fetchImpl.mock.calls.at(-1)[1].body)
    expect(body.actions).toMatchObject([{ action: 'update', file_path: 'old.yml', last_commit_id: 'file-commit' }, { action: 'create', file_path: 'new.yml' }])
    expect(body.actions.map(file => decodeContentBase64(file.content))).toEqual(['updated', 'new'])
    expect(body.force).not.toBe(true)
    expect(fetchImpl.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  })

  it('uses the Gitea multi-file endpoint with blob guards and a single commit', async () => {
    const fetchImpl = vi.fn(async () => reply({ commit: { sha: 'new-commit' } }, 201))
    const provider = new GiteaProvider({ token: 'pat', fetchImpl })
    expect(await provider.commitFiles(options)).toEqual({ sha: 'new-commit' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toMatch(/\/repos\/me\/catalog\/contents$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ branch: 'work', files: [{ path: 'old.yml', operation: 'update', sha: 'old-blob' }, { path: 'new.yml', operation: 'create' }] })
  })
})

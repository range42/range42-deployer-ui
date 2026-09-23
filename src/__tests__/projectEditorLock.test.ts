import { describe, expect, it, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { createProjectRepoAdapter } from '@/services/projectRepo'
import { openProjectDb } from '@/services/projectRepo/indexeddb'
import { assetFromBytes } from '@/services/projectFiles'

// Atomic per-file CAS, matching GitLab/Gitea rather than a stronger imaginary
// global branch lock. Snapshots are immutable and branches really inherit files.
function repository() {
  let serial = 0
  const snapshots = new Map<string, Map<string, { content: string; sha: string }>>()
  const heads = new Map([['main', 'base']])
  snapshots.set('base', new Map())
  const tree = (ref: string) => {
    const value = snapshots.get(heads.get(ref) || ref)
    if (!value) throw new Error('404 not found')
    return value
  }
  const provider = {
    id: 'gitlab', canWrite: async () => true,
    createBranch: vi.fn(async ({ from, name }) => {
      if (heads.has(name)) throw new Error('branch already exists')
      tree(from); heads.set(name, heads.get(from) || from)
    }),
    getFile: vi.fn(async ({ ref, path }) => {
      const file = tree(ref).get(path)
      if (!file) throw new Error('404 not found')
      return file
    }),
    listCommits: async ({ ref }) => { tree(ref); return [{ sha: heads.get(ref) || ref }] },
    commitFiles: vi.fn(async ({ branch, files }) => {
      const before = tree(branch)
      for (const file of files) if (before.get(file.path)?.sha !== file.sha) throw new Error('409 CAS conflict')
      const after = new Map(before)
      for (const file of files) after.set(file.path, { content: file.content, sha: `blob-${++serial}` })
      const sha = `commit-${++serial}`; snapshots.set(sha, after); heads.set(branch, sha)
      return { sha }
    }),
    putFile: vi.fn(async options => {
      await provider.commitFiles({ branch: options.branch, files: [options] })
      return { sha: tree(options.branch).get(options.path)!.sha }
    }),
    createPullRequest: vi.fn(async () => ({ url: 'https://git.test/pr/1', number: 1 })),
  }
  const adapter = (browserInstanceId: string, extra = {}) => createProjectRepoAdapter({
    provider: provider as never, source: { id: 'source', provider: 'gitlab', base_url: 'https://git.test',
      repos: [{ owner: 'owner', repo: 'repo', branch: 'main' }] }, branchStrategy: 'dedicated_repo',
    projectPath: '', workingBranch: 'shared', browserInstanceId, ...extra,
  })
  return { provider, adapter, tree, heads }
}

afterEach(() => vi.useRealTimers())

describe('distributed Git editor ownership', () => {
  it('does not start direct destination writes after release during source snapshot reads', async () => {
    const repo = repository(), adapter = repo.adapter('a')
    await adapter.stageFiles('project', { 'overlay.json': 'saved' }, 'save')
    const get = repo.provider.getFile
    let resume: () => void, entered: () => void, paused = false
    const waiting = new Promise<void>(resolve => { entered = resolve })
    repo.provider.getFile = vi.fn(async options => {
      if (!paused && options.path === 'overlay.json') { paused = true; entered(); await new Promise<void>(resolve => { resume = resolve }) }
      return get(options)
    })
    const publishing = adapter.publishDirect('project', 'publish').then(() => null, error => error)
    await waiting; const released = adapter.releaseLock('project'); resume!()
    expect(await publishing).toBeInstanceOf(Error)
    await released
    expect(repo.tree('main').size).toBe(0)
  })
  it('captures binary bytes before the asynchronous local-cache write', async () => {
    const repo = repository(), adapter = repo.adapter('a')
    const asset = assetFromBytes(Uint8Array.of(0, 255))
    const expected = { ...asset }
    const saving = adapter.autosave('immutable', { overlay: '{}', canvas_layout: '{}', meta: {}, files: { 'data.bin': asset } })
    Object.assign(asset, assetFromBytes(Uint8Array.of(1, 2)))
    await saving
    expect(repo.tree('shared').get('data.bin')!.content).toEqual(expected)
    expect((await (await openProjectDb()).get('drafts', 'immutable')).state.files['data.bin']).toEqual(expected)
  })
  it('refuses files outside the directory protected by this editor lock', async () => {
    const repo = repository(), adapter = repo.adapter('a', { projectPath: 'projects/owned' })
    await expect(Promise.resolve().then(() => adapter.stageFiles('project', { 'projects/other/file.yml': 'not ours' }, 'save'))).rejects.toThrow(/directory|scope/i)
    expect(repo.provider.createBranch).not.toHaveBeenCalled()
  })
  it('retires an in-flight save when navigation releases the editor during file reads', async () => {
    const repo = repository(), adapter = repo.adapter('a')
    await adapter.stageFiles('project', { 'overlay.json': 'saved' }, 'save')
    const get = repo.provider.getFile
    let resume: () => void, entered: () => void, paused = false
    const waiting = new Promise<void>(resolve => { entered = resolve })
    repo.provider.getFile = vi.fn(async options => {
      if (!paused && options.path === 'overlay.json') { paused = true; entered(); await new Promise<void>(resolve => { resume = resolve }) }
      return get(options)
    })
    const saving = adapter.stageFiles('project', { 'overlay.json': 'must stay local' }, 'navigation race').then(() => null, error => error)
    await waiting
    const released = adapter.releaseLock('project')
    resume!()
    expect((await saving)?.message).toMatch(/retired|closed|lost|changed/i)
    await released
    expect(repo.tree('shared').get('overlay.json')!.content).toBe('saved')
    expect(JSON.parse(repo.tree('shared').get('.lock')!.content).released).toBe(true)
  })

  it('never clears retirement when an already-dispatched acquisition returns late', async () => {
    const repo = repository(), adapter = repo.adapter('a'), commit = repo.provider.commitFiles
    let resume: () => void, entered: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    repo.provider.commitFiles = vi.fn(async options => {
      if (options.message === 'Acquire Range42 editor lock') { entered(); await new Promise<void>(resolve => { resume = resolve }) }
      return commit(options)
    })
    const saving = adapter.stageFiles('project', { 'overlay.json': 'never write' }, 'save').then(() => null, error => error)
    await waiting; const released = adapter.releaseLock('project'); resume!()
    expect(await saving).toBeInstanceOf(Error)
    await released
    expect(repo.tree('shared').has('overlay.json')).toBe(false)
    expect(JSON.parse(repo.tree('shared').get('.lock')!.content).released).toBe(true)
  })
  it('refuses credential-bearing target URLs before a lock can publish them', () => {
    const repo = repository()
    expect(() => repo.adapter('a', { source: { id: 'private', provider: 'gitlab', base_url: 'https://user:private-value@git.test', repos: [{ owner: 'owner', repo: 'repo', branch: 'main' }] } })).toThrow(/credential|public/i)
    expect(repo.provider.commitFiles).not.toHaveBeenCalled()
  })
  it('fences an old write paused across expiry and takeover using per-file CAS', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-14T12:00:00Z')
    const repo = repository(), a = repo.adapter('a'), b = repo.adapter('b')
    const commit = repo.provider.commitFiles
    let resume: () => void, entered: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    repo.provider.commitFiles = vi.fn(async options => {
      if (options.message === 'old writer') { entered(); await new Promise<void>(resolve => { resume = resolve }) }
      return commit(options)
    })
    const old = a.stageFiles('project', { 'overlay.json': 'old' }, 'old writer')
    const rejected = old.then(() => null, error => error)
    await waiting
    vi.setSystemTime('2026-09-14T12:04:00Z')
    await b.acquireLock('project', { recoverExpired: true })
    await b.stageFiles('project', { 'overlay.json': 'new owner' }, 'new writer')
    resume!(); expect((await rejected)?.message).toMatch(/confirmed|conflict/i)
    expect(repo.tree('shared').get('overlay.json')!.content).toBe('new owner')
  })

  it('creates an independent recovery branch from a pinned snapshot without stealing its copied lock', async () => {
    const repo = repository(), a = repo.adapter('a')
    await a.stageFiles('project', { 'overlay.json': 'reviewed' }, 'save')
    const saved = await a.save('project', 'save'), original = repo.tree('shared').get('.lock')
    const copy = repo.adapter('b', { workingBranch: 'recovery', branchFrom: saved.commit_sha, expectedRevision: saved.commit_sha })
    await copy.stageFiles('project', { 'overlay.json': 'local recovery' }, 'save copy')
    expect(repo.tree('shared').get('.lock')).toEqual(original)
    expect(repo.tree('shared').get('overlay.json')!.content).toBe('reviewed')
    expect(repo.tree('recovery').get('overlay.json')!.content).toBe('local recovery')
  })

  it('refuses a context switch during branch preparation before the create request', async () => {
    const repo = repository()
    let valid = true, reads = 0
    const list = repo.provider.listCommits
    repo.provider.listCommits = async options => { const result = await list(options); if (++reads === 2) valid = false; return result }
    await expect(repo.adapter('a', { contextValid: () => valid }).stageFiles('project', { 'overlay.json': 'ours' }, 'save')).rejects.toThrow(/changed/i)
    expect(repo.provider.createBranch).not.toHaveBeenCalled()
  })

  it('does not replay an unconfirmed write through an unexpired recovery action', async () => {
    const repo = repository(), adapter = repo.adapter('a'), commit = repo.provider.commitFiles
    repo.provider.commitFiles = vi.fn(async options => {
      const result = await commit(options)
      if (options.files.some(file => file.path === 'overlay.json')) throw new Error('Response lost after commit')
      return result
    })
    await expect(adapter.stageFiles('project', { 'overlay.json': 'committed once' }, 'save')).rejects.toThrow(/not be confirmed/i)
    const head = repo.heads.get('shared')
    await expect(adapter.acquireLock('project', { recoverExpired: true })).rejects.toThrow(/not expired/i)
    expect(repo.heads.get('shared')).toBe(head)
  })
  it('allows one concurrent owner and never overwrites its live lease', async () => {
    const repo = repository()
    const result = await Promise.allSettled([repo.adapter('a').acquireLock('project'), repo.adapter('b').acquireLock('project')])
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const owner = JSON.parse(repo.tree('shared').get('.lock')!.content).browser_instance_id
    await expect(repo.adapter(owner === 'a' ? 'b' : 'a').acquireLock('project')).rejects.toThrow(/another editor|lock/i)
    expect(JSON.parse(repo.tree('shared').get('.lock')!.content).browser_instance_id).toBe(owner)
  })

  it('requires explicit expired-owner recovery and fences the old heartbeat and release', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-14T12:00:00Z')
    const repo = repository(), a = repo.adapter('a'), b = repo.adapter('b')
    await a.acquireLock('project')
    vi.setSystemTime('2026-09-14T12:04:00Z')
    await expect(b.acquireLock('project')).rejects.toThrow(/expired|recover/i)
    await b.acquireLock('project', { recoverExpired: true })
    const lock = repo.tree('shared').get('.lock')
    await expect(a.heartbeat('project')).rejects.toThrow(/lock|owner/i)
    await a.releaseLock('project')
    expect(repo.tree('shared').get('.lock')).toEqual(lock)
    await b.releaseLock('project')
    await repo.adapter('c').acquireLock('project')
  })

  it('refuses malformed ownership even with expired recovery requested', async () => {
    const repo = repository(); await repo.provider.createBranch({ from: 'main', name: 'shared' })
    await repo.provider.putFile({ branch: 'shared', path: '.lock', content: '{broken' })
    const before = repo.heads.get('shared')
    await expect(repo.adapter('a').acquireLock('project', { recoverExpired: true })).rejects.toThrow(/invalid|malformed/i)
    expect(repo.heads.get('shared')).toBe(before)
  })

  it('checks the owned lock in the SAME atomic commit as project bytes', async () => {
    const repo = repository(), adapter = repo.adapter('a')
    await adapter.stageFiles('project', { 'overlay.json': 'ours' }, 'save')
    const write = repo.provider.commitFiles.mock.calls.find(([call]) => call.files.some(file => file.path === 'overlay.json'))![0]
    expect(write.files.map(file => file.path)).toContain('.lock')
    expect(write.files.find(file => file.path === '.lock')?.sha).toBeTruthy()
  })

  it('refuses stale project overwrite after another editor has saved and released', async () => {
    const repo = repository(), a = repo.adapter('a')
    await a.stageFiles('project', { 'overlay.json': 'reviewed' }, 'save')
    const reviewed = (await a.save('project', 'save')).commit_sha
    await a.releaseLock('project')
    const b = repo.adapter('b', { expectedRevision: reviewed })
    await b.stageFiles('project', { 'overlay.json': 'newer' }, 'save'); await b.releaseLock('project')
    const stale = repo.adapter('c', { expectedRevision: reviewed })
    await expect(stale.stageFiles('project', { 'overlay.json': 'stale local' }, 'save')).rejects.toThrow(/changed|conflict|review/i)
    expect(repo.tree('shared').get('overlay.json')!.content).toBe('newer')
  })

  it('preserves a complete local binary draft before an ownership refusal', async () => {
    const repo = repository(); await repo.adapter('other').acquireLock('project')
    const state = { overlay: '{}', canvas_layout: '{}', meta: { name: 'unsaved' }, files: { 'data.bin': assetFromBytes(Uint8Array.of(0, 255)) } }
    await expect(repo.adapter('mine').autosave('project', state)).rejects.toThrow()
    const db = await openProjectDb()
    expect((await db.get('drafts', 'project')).state).toEqual(state)
    expect(repo.tree('shared').has('data.bin')).toBe(false)
  })

  it('does not revive an expired own lease by heartbeat', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-14T12:00:00Z')
    const repo = repository(), adapter = repo.adapter('a'); await adapter.acquireLock('project')
    vi.setSystemTime('2026-09-14T12:04:00Z')
    const before = repo.heads.get('shared')
    await expect(adapter.heartbeat('project')).rejects.toThrow(/expired|lock/i)
    expect(repo.heads.get('shared')).toBe(before)
  })

  it('refuses providers without atomic commits before any remote write', async () => {
    const repo = repository(); repo.provider.commitFiles = undefined as never
    await expect(repo.adapter('a').stageFiles('project', { 'overlay.json': 'ours' }, 'save')).rejects.toThrow(/atomic/i)
    expect(repo.provider.createBranch).not.toHaveBeenCalled()
  })

  it('does not overwrite intervening destination changes on direct publication', async () => {
    const repo = repository(), adapter = repo.adapter('a')
    await adapter.stageFiles('project', { 'overlay.json': 'ours' }, 'save')
    await repo.provider.putFile({ branch: 'main', path: 'overlay.json', content: 'external' })
    await expect(adapter.publishDirect('project', 'publish')).rejects.toThrow(/changed|conflict|review/i)
    expect(repo.tree('main').get('overlay.json')!.content).toBe('external')
  })
})

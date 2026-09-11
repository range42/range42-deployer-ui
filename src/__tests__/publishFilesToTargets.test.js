import { beforeEach, describe, it, expect, vi } from 'vitest'
import { assetFromBytes, fileBytes } from '@/services/projectFiles'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { getProvider } from '@/services/git'
import { publishFilesToTargets, useProjectGitSync, buildProjectFiles } from '@/composables/useProjectGitSync'

vi.mock('@/services/git', () => ({ getProvider: vi.fn() }))

function repository() {
  const files = new Map()
  const calls = []
  const branches = new Set(['main'])
  let head = 0
  return { files, calls, provider: {
    canWrite: async () => true,
    createBranch: async ({ name, from }) => {
      if (branches.has(name)) throw Error('Branch already exists')
      branches.add(name)
      for (const [key, value] of [...files]) {
        if (key.startsWith(`${from}:`)) files.set(`${name}:${key.slice(from.length + 1)}`, value)
      }
    },
    getFile: async ({ path, ref }) => {
      const file = files.get(`${ref}:${path}`)
      if (!file) throw Error('404 not found')
      return file
    },
    putFile: async options => {
      calls.push(options)
      const value = { content: options.content, sha: `blob-${++head}` }
      files.set(`${options.branch}:${options.path}`, value)
      return value
    },
    listCommits: async ({ ref }) => [{ sha: `${ref}-commit-${head}` }],
    listTree: async ({ ref, path }) => [...files.keys()]
      .filter(key => key.startsWith(`${ref}:${path}/`)).map(key => ({ path: key.split(':')[1], type: 'blob' })),
    createPullRequest: vi.fn(async () => ({ url: 'https://public.test/pulls/1', number: 1 })),
  } }
}

const binding = {
  source_id: 'primary', provider: 'github', base_url: 'https://primary.test',
  repo_owner: 'owner', repo_name: 'project', branch: 'main', branch_strategy: 'dedicated_repo',
}
const targets = [
  { id: 'public', source_id: 'public-source', provider: 'gitlab', base_url: 'https://public.test', repo_owner: 'org', repo_name: 'catalog', base_branch: 'main', mode: 'pull_request' },
  { id: 'private', source_id: 'private-source', provider: 'gitea', base_url: 'https://private.test', repo_owner: 'me', repo_name: 'catalog', base_branch: 'main', mode: 'direct' },
]
const rolePath = '02_ansible_layer/admin/roles/software.install.demo'
const files = { [`${rolePath}/tasks/main.yml`]: '- name: Demo\n  ansible.builtin.debug:\n    msg: Demo\n', [`${rolePath}/README.md`]: '# Demo\n' }
let repos
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  repos = { github: repository(), gitlab: repository(), gitea: repository() }
  getProvider.mockReset()
  getProvider.mockImplementation(kind => repos[kind].provider)
})

describe('publishFilesToTargets', () => {
  it('keeps Gitea contribution branches within its 100-character API bound with stable distinct identities', async () => {
    const create = repos.gitea.provider.createBranch
    const names = []
    repos.gitea.provider.createBranch = async options => {
      if (options.name.length > 100) throw new Error('Gitea branch name exceeds 100 characters')
      names.push(options.name)
      return create(options)
    }
    const target = { ...targets[1], id: 'target-'.repeat(10), base_branch: 'a-review-branch-with-a-descriptive-name',
      subdir: 'projects/a-project-with-a-descriptive-name', mode: 'pull_request' }
    const args = { projectId: 'long-project-name-'.repeat(4), binding, files, message: 'Save' }
    const first = await publishFilesToTargets(args, [target])
    const retry = await publishFilesToTargets(args, [target])
    const changed = await publishFilesToTargets(args, [{ ...target, subdir: `${target.subdir}-different` }])
    expect([first, retry, changed].every(result => result.targets[0].status === 'published')).toBe(true)
    expect(names[0]).toBe(names[1])
    expect(names[2]).not.toBe(names[0])
    expect(names.every(name => name.length <= 100)).toBe(true)
  })
  it('rejects an oversized complete project before attempting a repository fork', async () => {
    repos.github.provider.canWrite = async () => false
    repos.github.provider.ensureFork = vi.fn(async () => ({ owner: 'fork', repo: 'project', default_branch: 'main' }))
    const args = { projectId: 'too-large', binding, canvas: { nodes: [], edges: [], attachments: [] }, meta: { name: 'oversized' },
      files: { 'content/a.txt': 'a'.repeat(1024 * 1024), 'content/b.txt': 'b'.repeat(1024 * 1024) } }
    await expect(Promise.resolve().then(() => useProjectGitSync().pushToGit(args))).rejects.toThrow(/2 MiB/)
    expect(repos.github.provider.ensureFork).not.toHaveBeenCalled()
  })
  it('protects generated manifest filenames when building authored project files', () => {
    expect(() => buildProjectFiles({ projectId: 'bad', binding, canvas: { nodes: [], edges: [], attachments: [] }, meta: { name: 'bad' }, files: { 'meta.json': '{}' } })).toThrow(/reserved/i)
  })

  it('publishes the same captured binary bytes to public review and private main', async () => {
    const asset = assetFromBytes(Uint8Array.from({ length: 256 }, (_, i) => i))
    const expected = [...fileBytes(asset)]
    const draft = { 'content/fixture.bin': asset }
    const publishing = publishFilesToTargets({ projectId: 'binary', binding, files: draft, message: 'Binary snapshot' }, targets)
    Object.assign(asset, assetFromBytes(Uint8Array.of(1, 2)))
    const result = await publishing
    expect(result.targets.every(target => target.status === 'published')).toBe(true)
    for (const [kind, ref] of [['github', result.branch], ['gitlab', result.targets.find(target => target.target_id === 'public').branch], ['gitea', 'main']]) {
      expect([...fileBytes(repos[kind].files.get(`${ref}:content/fixture.bin`).content)]).toEqual(expected)
    }
    expect(repos.gitlab.provider.createPullRequest).toHaveBeenCalledOnce()
  })

  it('uses one atomic destination commit and never falls back to partial writes after rejection', async () => {
    const repo = repos.gitea
    const getFile = repo.provider.getFile
    repo.provider.getFile = options => getFile({ ...options, ref: options.ref.replace(/-commit-\d+$/, '') })
    repo.provider.commitFiles = vi.fn(async options => {
      if (options.branch === 'main') throw Error('Protected file rejected entire commit')
      for (const file of options.files) repo.files.set(`${options.branch}:${file.path}`, { content: file.content, sha: 'atomic-blob' })
      return { sha: 'atomic-commit' }
    })
    const result = await publishFilesToTargets({ projectId: 'atomic', binding, files, message: 'Add' }, [targets[1]])
    expect(result.targets[0]).toMatchObject({ status: 'failed', partial: false })
    expect(result.targets[0].error).toContain('Atomic publication could not be confirmed')
    expect(repo.provider.commitFiles).toHaveBeenCalledTimes(2)
    expect(repo.calls).toHaveLength(0)
    expect([...repo.files.keys()].some(path => path.startsWith('main:'))).toBe(false)
  })
  it('publishes to a personal fork when upstream is read-only, while the PR still targets upstream', async () => {
    const upstream = repos.gitlab.provider
    upstream.canWrite = async owner => owner === 'me'
    upstream.ensureFork = vi.fn(async () => ({ owner: 'me', repo: 'catalog', default_branch: 'main' }))
    const result = await publishFilesToTargets({ projectId: 'fork-demo', binding, files, message: 'Add' }, [targets[0]])
    expect(result.targets[0]).toMatchObject({ status: 'published', fork: { owner: 'me', repo: 'catalog' } })
    expect(upstream.ensureFork).toHaveBeenCalledWith({ owner: 'org', repo: 'catalog' })
    expect(repos.gitlab.calls.every(call => call.owner === 'me')).toBe(true)
    expect(upstream.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'org', repo: 'catalog', source: { owner: 'me', repo: 'catalog' }, to: 'main',
    }))
  })

  it('keeps the review number and selected organization destination with publication results', async () => {
    repos.gitlab.provider.ensureFork = vi.fn(async () => ({ owner: 'training', repo: 'catalog', default_branch: 'main' }))
    const result = await publishFilesToTargets({ projectId: 'org-fork', binding, files, message: 'Add' }, [
      { ...targets[0], fork_policy: 'fork', fork_owner: 'training' },
    ])
    expect(repos.gitlab.provider.ensureFork).toHaveBeenCalledWith({ owner: 'org', repo: 'catalog', destination: 'training' })
    expect(result.targets[0]).toMatchObject({ pr_number: 1, destination: expect.objectContaining({ repo_owner: 'org', fork_owner: 'training' }) })
  })

  it('does not fork a direct destination or an upstream-only PR destination without permission', async () => {
    repos.gitlab.provider.canWrite = async () => false
    repos.gitlab.provider.ensureFork = vi.fn()
    const result = await publishFilesToTargets({ projectId: 'no-fork', binding, files, message: 'Add' }, [
      { ...targets[0], fork_policy: 'upstream' }, { ...targets[0], id: 'direct', mode: 'direct' },
    ])
    expect(result.targets.every(target => target.status === 'failed')).toBe(true)
    expect(repos.gitlab.provider.ensureFork).not.toHaveBeenCalled()
  })

  it('saves read-only primary projects in a fork and returns the actual binding for deployment', async () => {
    const primary = repos.github.provider
    primary.canWrite = async owner => owner === 'me'
    primary.ensureFork = vi.fn(async () => ({ owner: 'me', repo: 'project', default_branch: 'main' }))
    const result = await useProjectGitSync().pushToGit({ projectId: 'fork-save', binding,
      canvas: { nodes: [], edges: [], attachments: [] }, meta: { name: 'Fork save' }, files })
    expect(result.binding).toMatchObject({ ...binding, repo_owner: 'me', fork_policy: 'upstream' })
    expect(repos.github.calls.every(call => call.owner === 'me' && call.branch === 'range42-ui/fork-save')).toBe(true)
    expect(result.commit_sha).toContain('range42-ui/fork-save')
  })

  it('opens a project merge proposal from the saved fork instead of a missing upstream branch', async () => {
    const primary = repos.github.provider
    primary.canWrite = async owner => owner === 'me'
    primary.ensureFork = vi.fn(async () => ({ owner: 'me', repo: 'project', default_branch: 'main' }))
    await useProjectGitSync().proposeMerge({ projectId: 'fork-merge', binding,
      canvas: { nodes: [], edges: [], attachments: [] }, meta: { name: 'Fork proposal' }, files })
    expect(primary.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'owner', repo: 'project', source: { owner: 'me', repo: 'project' }, from: 'range42-ui/fork-merge',
    }))
  })

  it('checkpoints public-only component contributions in a personal fork', async () => {
    repos.github.provider.canWrite = async owner => owner === 'me'
    repos.github.provider.ensureFork = vi.fn(async () => ({ owner: 'me', repo: 'project', default_branch: 'main' }))
    const result = await publishFilesToTargets({ projectId: 'fork-primary', binding, files, message: 'Add' }, [targets[0]])
    expect(result.binding.repo_owner).toBe('me')
    expect(result.targets[0].status).toBe('published')
    expect(repos.github.calls.every(call => call.owner === 'me')).toBe(true)
  })
  it('checkpoints once and publishes one snapshot as public PR and private direct writes', async () => {
    const result = await publishFilesToTargets({ projectId: 'component-demo', binding, files, message: 'Add demo' }, targets)
    expect(result.branch).toBe('range42-ui/component-demo')
    expect(result.targets.map(target => target.status)).toEqual(['published', 'published'])
    expect(result.targets[0].pr_url).toBe('https://public.test/pulls/1')
    expect(result.targets[1].commit_sha).toContain('main-commit-')
    for (const [path, content] of Object.entries(files)) {
      expect(repos.github.files.get(`range42-ui/component-demo:${path}`).content).toBe(content)
      expect(repos.gitlab.files.get(`${result.targets[0].branch}:${path}`).content).toBe(content)
      expect(repos.gitea.files.get(`main:${path}`).content).toBe(content)
    }
    expect(repos.github.calls.some(call => call.branch === 'main')).toBe(false)
    expect(repos.gitlab.calls.some(call => call.branch === 'main')).toBe(false)
  })

  it('reports one protected destination failure while publishing the other destination', async () => {
    repos.gitlab.provider.createPullRequest.mockRejectedValue(Error('Repository policy denied PR'))
    const result = await publishFilesToTargets({ projectId: 'demo', binding, files, message: 'Add' }, targets)
    expect(result.targets[0]).toMatchObject({ target_id: 'public', status: 'failed', error: 'Repository policy denied PR' })
    expect(result.targets[1].status).toBe('published')
  })

  it('rejects an existing component directory for create-only publication per destination', async () => {
    repos.gitea.files.set(`main:${rolePath}/existing.txt`, { content: 'Keep', sha: 'existing' })
    const result = await publishFilesToTargets({
      projectId: 'demo', binding, files, message: 'Add', createOnly: true, componentPath: rolePath,
    }, targets)
    expect(result.targets[0].status).toBe('published')
    expect(result.targets[1].status).toBe('failed')
    expect(result.targets[1].error).toMatch(/already exists/i)
    expect(repos.gitea.calls).toHaveLength(0)
  })

  it('rejects a primary repository component collision before creating the checkpoint', async () => {
    repos.github.files.set(`main:${rolePath}/old.txt`, { content: 'Keep', sha: 'old' })
    await expect(publishFilesToTargets({ projectId: 'demo', binding, files, message: 'Add', createOnly: true, componentPath: rolePath }, targets))
      .rejects.toThrow(/already exists/i)
    expect(repos.github.calls).toHaveLength(0)
    expect(repos.gitlab.calls).toHaveLength(0)
  })

  it('rejects a conflicting existing checkpoint branch for a new component', async () => {
    repos.github.files.set(`range42-ui/demo:${rolePath}/README.md`, { content: 'Other draft', sha: 'old' })
    await expect(publishFilesToTargets({ projectId: 'demo', binding, files, message: 'Add', createOnly: true, componentPath: rolePath }, targets))
      .rejects.toThrow(/already exists|another draft/i)
    expect(repos.github.calls).toHaveLength(0)
  })

  it('reports a partially written direct destination if a later file write fails', async () => {
    const put = repos.gitea.provider.putFile
    repos.gitea.provider.putFile = async options => {
      if (options.branch === 'main' && options.path.endsWith('README.md')) throw Error('Protected path')
      return put(options)
    }
    const result = await publishFilesToTargets({ projectId: 'demo', binding, files, message: 'Add' }, targets)
    expect(result.targets[0].status).toBe('published')
    expect(result.targets[1]).toMatchObject({ status: 'failed', partial: true })
    expect(result.targets[1].error).toMatch(/1 file.*written/i)
  })

  it('retries a failed target from the identical own checkpoint', async () => {
    repos.gitlab.provider.createPullRequest.mockRejectedValueOnce(Error('Try again'))
    const args = { projectId: 'retry-draft', binding, files, message: 'Add', createOnly: true, componentPath: rolePath }
    const first = await publishFilesToTargets(args, targets)
    const before = repos.github.calls.length
    const retried = await publishFilesToTargets(args, [targets[0]])
    expect(first.targets[0].status).toBe('failed')
    expect(retried.targets[0].status).toBe('published')
    expect(repos.github.calls.length).toBe(before)
    expect(retried.commit_sha).toBe(first.commit_sha)
  })

  it('retries public PR after the primary repository was published directly', async () => {
    const privateTarget = { ...targets[1], provider: 'github', base_url: binding.base_url, repo_owner: binding.repo_owner, repo_name: binding.repo_name }
    repos.gitlab.provider.createPullRequest.mockRejectedValueOnce(Error('Try again'))
    const args = { projectId: 'retry-draft', binding, files, message: 'Add', createOnly: true, componentPath: rolePath }
    const first = await publishFilesToTargets(args, [privateTarget, targets[0]])
    expect(first.targets.map(target => target.status)).toEqual(['published', 'failed'])
    const retried = await publishFilesToTargets(args, [targets[0]])
    expect(retried.targets[0].status).toBe('published')
  })

  it('resumes its own partial direct publication while preserving unrelated collisions', async () => {
    const put = repos.gitea.provider.putFile
    let fail = true
    repos.gitea.provider.putFile = async options => {
      if (fail && options.branch === 'main' && options.path.endsWith('README.md')) throw Error('Temporary failure')
      return put(options)
    }
    const args = { projectId: 'retry-partial', binding, files, message: 'Add', createOnly: true, componentPath: rolePath }
    const first = await publishFilesToTargets(args, [targets[1]])
    expect(first.targets[0].partial).toBe(true)
    fail = false
    const retried = await publishFilesToTargets(args, [targets[1]])
    expect(retried.targets[0].status).toBe('published')
  })

  it('isolates publication branches for different destinations in the same repository', async () => {
    const second = { ...targets[0], id: 'second', base_branch: 'release', subdir: 'labs/b' }
    const result = await publishFilesToTargets({ projectId: 'demo', binding, files, message: 'Add' }, [
      { ...targets[0], subdir: 'labs/a' }, second,
    ])
    const branches = result.targets.map(target => target.branch)
    expect(new Set(branches).size).toBe(2)
    expect(branches).not.toContain(result.branch)
    expect(repos.gitlab.files.has(`${branches[0]}:labs/b/${rolePath}/README.md`)).toBe(false)
  })

  it('captures every destination connection before a backend switch during publication', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old-backend.test' })
    const next = backend.addHost({ url: 'https://new-backend.test' })
    const inventory = useInventoryStore()
    inventory.addSource({ id: 'public-source', provider: 'gitlab', base_url: 'https://public.test', repos: [], auth: { kind: 'none' } })
    inventory.setToken('public-source', 'old-source-token')
    let release
    repos.github.provider.canWrite = () => new Promise(resolve => { release = resolve })
    const publishing = publishFilesToTargets({ projectId: 'demo', binding, files, message: 'Add' }, [targets[0]])
    await flushPromises()
    backend.setActiveHost(next)
    inventory.setToken('public-source', 'new-source-token')
    release(true)
    await publishing
    const call = getProvider.mock.calls.find(([kind]) => kind === 'gitlab')
    expect(call[1].token).toBe('old-source-token')
  })

  it.each(['autosave-first', 'publication-first'])('serializes checkpoint writes across callers: %s', async order => {
    let release
    let firstPermission = true
    repos.github.provider.canWrite = () => {
      if (firstPermission) {
        firstPermission = false
        return new Promise(resolve => { release = resolve })
      }
      return Promise.resolve(true)
    }
    const auto = () => useProjectGitSync().pushToGit({
      projectId: 'shared', binding, canvas: { nodes: [], edges: [], attachments: [] },
      meta: { name: 'Auto' }, overlay: { param_overrides: { env: { PORT: '8080' } } },
    })
    const publish = () => publishFilesToTargets({
      projectId: 'shared', binding, files: { 'overlay.json': '{"published":true}' }, message: 'Publish',
    }, [targets[0]])
    const first = order === 'autosave-first' ? auto() : publish()
    const second = order === 'autosave-first' ? publish() : auto()
    await flushPromises()
    expect(repos.github.calls).toHaveLength(0)
    release(true)
    await Promise.all([first, second])
    const overlay = repos.github.files.get('range42-ui/shared:overlay.json').content
    if (order === 'autosave-first') expect(JSON.parse(overlay)).toEqual({ published: true })
    else expect(JSON.parse(overlay)).toEqual({ param_overrides: { env: { PORT: '8080' } } })
  })

  it('captures the file snapshot before asynchronous writes', async () => {
    const draft = { ...files }
    const promise = publishFilesToTargets({ projectId: 'demo', binding, files: draft, message: 'Add' }, targets)
    draft[`${rolePath}/README.md`] = 'Changed after clicking Publish'
    await promise
    expect(repos.gitea.files.get(`main:${rolePath}/README.md`).content).toBe('# Demo\n')
  })

  it('rejects unsafe file paths before any repository write', async () => {
    await expect(publishFilesToTargets({ projectId: 'demo', binding, files: { '../escape': 'x' }, message: 'Add' }, targets))
      .rejects.toThrow(/path/i)
    expect(repos.github.calls).toHaveLength(0)
  })
})

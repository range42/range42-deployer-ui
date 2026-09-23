import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { loadGitProject, prepareGitProjectImport } from '@/services/gitProjectOpen'
import { buildProjectFiles, buildPushArgs } from '@/composables/useProjectGitSync'
import { useInventoryStore } from '@/stores/inventoryStore'
import * as nativeFiles from '@/services/nativeScenario'

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('@/services/git', () => ({ getProvider }))
const sha = 'a'.repeat(40)
const path = 'training/my-lab'
const binding = { source_id: 'native', provider: 'github', base_url: 'https://github.com',
  repo_owner: 'owner', repo_name: 'playbooks', branch: 'sdn', branch_strategy: 'dedicated_repo' }
let files, provider, tree
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia())
  useInventoryStore().addSource({ id: 'native', provider: 'github', base_url: 'https://github.com', repos: [], auth: { kind: 'none' } })
  files = {
    [`${path}/main.yml`]: '- import_playbook: stage/main.yml\n',
    [`${path}/stage/main.yml`]: '- hosts: proxmox\n  tasks: []\n',
    [`${path}/manifest/scenario_vms.json`]: JSON.stringify({ version: 2, scenario: 'my-lab', vms: [{ vm_id: 2001 }] }),
    [`${path}/my-lab.setup.sh`]: '#!/bin/sh\nexec ansible-playbook main.yml\n',
    'bundles/shared/main.yml': '- hosts: all\n',
  }
  tree = Object.keys(files).map(path => ({ path, type: 'blob', sha: 'blob', mode: path.endsWith('.sh') ? '100755' : '100644' }))
  provider = {
    listCommits: vi.fn(async () => [{ sha }]), listTree: vi.fn(async () => tree),
    getFileContent: vi.fn(async ({ path }) => {
      if (!(path in files)) throw Object.assign(new Error('Not found'), { status: 404 })
      return { content: files[path], sha: 'blob' }
    }), createBranch: vi.fn(), putFile: vi.fn(),
  }
  getProvider.mockReturnValue(provider)
})

it.each(['github', 'gitlab', 'gitea'])('opens a native %s repository at one commit without UI topology', async kind => {
  const preview = await loadGitProject({ ...binding, provider: kind }, [], { nativePath: path })
  const project = prepareGitProjectImport(preview)
  expect(project.native_scenario).toEqual({ version: 1, path })
  expect(project.git.branch_from).toBe(sha)
  expect(project.files[`${path}/my-lab.setup.sh`]).toBe(files[`${path}/my-lab.setup.sh`])
  expect(project.scenario).toBeUndefined()
  expect(project.scenario_generated_paths).toEqual([])
  expect(provider.getFileContent.mock.calls.every(([options]) => options.ref === sha)).toBe(true)
  expect(provider.createBranch).not.toHaveBeenCalled()
})

it('preserves native identity and edited playbooks through ordinary save and reopen', async () => {
  const project = prepareGitProjectImport(await loadGitProject(binding, [], { nativePath: path }))
  project.files[`${path}/stage/main.yml`] += '# my customization\n'
  const snapshot = buildProjectFiles(buildPushArgs(project, [], []))
  expect(JSON.parse(snapshot['meta.json']).ui_project.native_scenario).toEqual({ version: 1, path })
  files = { ...files, ...snapshot }
  const restored = prepareGitProjectImport(await loadGitProject(binding, []))
  expect(restored.native_scenario).toEqual(project.native_scenario)
  expect(restored.files[`${path}/stage/main.yml`]).toContain('# my customization')
  expect(restored.scenario).toBeUndefined()
})

it('preserves unedited dependencies in the seeded Git tree without copying them into browser storage', async () => {
  const project = prepareGitProjectImport(await loadGitProject(binding, [], { nativePath: path }))
  const snapshot = buildProjectFiles(buildPushArgs(project, [], []))
  expect(snapshot).not.toHaveProperty('bundles/shared/main.yml')
  expect(project.git.branch_from).toBe(sha)
})

it.each(['../outside', '/absolute', 'training/../outside'])('rejects invalid native path %s', async nativePath => {
  await expect(loadGitProject(binding, [], { nativePath })).rejects.toThrow(/path|relative|traversal/i)
})

it('does not read native secret links as project files', async () => {
  tree.push({ path: `${path}/secrets`, type: 'blob', mode: '120000', sha: 'secret-link' })
  const preview = await loadGitProject(binding, [], { nativePath: path })
  expect(preview.files).not.toHaveProperty(`${path}/secrets`)
  expect(provider.getFileContent.mock.calls.some(([options]) => options.path === `${path}/secrets`)).toBe(false)
})

it('refuses overwriting unrelated root metadata when opening a native project', async () => {
  files['meta.json'] = '{"unrelated":true}'
  tree.push({ path: 'meta.json', type: 'blob', mode: '100644', sha: 'metadata' })
  await expect(loadGitProject(binding, [], { nativePath: path })).rejects.toThrow(/metadata|project/i)
})

it('uses the catalog-selected revision instead of silently following a moving source branch', async () => {
  const pinned = 'b'.repeat(40)
  const preview = await loadGitProject(binding, [], { nativePath: path, revision: pinned })
  expect(preview.revision.commit_sha).toBe(pinned)
  expect(provider.getFileContent.mock.calls.every(([options]) => options.ref === pinned)).toBe(true)
})

it('opens another scenario from a repository already saved as a native project', async () => {
  const first = prepareGitProjectImport(await loadGitProject(binding, [], { nativePath: path }))
  const saved = buildProjectFiles(buildPushArgs(first, [], []))
  files = { ...files, ...saved,
    'training/second/main.yml': '- hosts: all\n',
    'training/second/manifest/scenario_vms.json': '{"version":2,"vms":[]}' }
  tree = Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644', sha: 'blob' }))
  const second = prepareGitProjectImport(await loadGitProject(binding, [], { nativePath: 'training/second' }))
  expect(second.native_scenario.path).toBe('training/second')
  expect(second.git.branch_from).toBe(sha)
  expect(provider.putFile).not.toHaveBeenCalled()
})

it('opens large native scenarios without copying all files into browser storage', async () => {
  for (let i = 0; i < 1030; i += 1) {
    const name = `${path}/assets/${i}.txt`
    files[name] = 'asset'
    tree.push({ path: name, type: 'blob', mode: '100644', sha: 'blob' })
  }
  const preview = await loadGitProject(binding, [], { nativePath: path })
  expect(preview.authoring.native_scenario.path).toBe(path)
  expect(provider.getFileContent.mock.calls.length).toBeLessThan(150)
})

it('loads scenario files with bounded concurrency so opening does not wait for every request sequentially', async () => {
  const original = provider.getFileContent.getMockImplementation()
  let active = 0, peak = 0
  provider.getFileContent.mockImplementation(async (...args) => {
    active += 1; peak = Math.max(peak, active)
    await Promise.resolve()
    try { return await original(...args) } finally { active -= 1 }
  })
  await loadGitProject(binding, [], { nativePath: path })
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(8)
})

it('lets the editor read and customize shared dependencies at the pinned revision', async () => {
  expect(nativeFiles.createNativeFilesFs).toBeTypeOf('function')
  const local = { listTree: vi.fn(async () => []), getFile: vi.fn(async () => { throw new Error('not found') }),
    putFile: vi.fn(async input => input) }
  const fs = nativeFiles.createNativeFilesFs(binding, sha, provider, local)
  expect((await fs.listTree()).some(file => file.path === 'bundles/shared/main.yml')).toBe(true)
  expect((await fs.getFile('bundles/shared/main.yml')).content).toBe(files['bundles/shared/main.yml'])
  await fs.putFile({ path: 'bundles/shared/main.yml', content: '- hosts: customized\n' })
  expect(local.putFile).toHaveBeenCalledWith({ path: 'bundles/shared/main.yml', content: '- hosts: customized\n' })
  expect(provider.getFileContent).toHaveBeenCalledWith(expect.objectContaining({ ref: sha }))
})

it('keeps context credentials and symlinks out of the repository editor', async () => {
  expect(nativeFiles.createNativeFilesFs).toBeTypeOf('function')
  tree.push({ path: 'secrets/password.txt', type: 'blob', mode: '100644', sha: 'blob' },
    { path: 'linked', type: 'blob', mode: '120000', sha: 'blob' })
  const fs = nativeFiles.createNativeFilesFs(binding, sha, provider, { listTree: async () => [], putFile: vi.fn() })
  const paths = (await fs.listTree()).map(file => file.path)
  expect(paths).not.toContain('secrets/password.txt')
  expect(paths).not.toContain('linked')
  await expect(fs.getFile('secrets/password.txt')).rejects.toThrow()
  await expect(fs.putFile({ path: 'secrets/password.txt', content: 'secret' })).rejects.toThrow()
})

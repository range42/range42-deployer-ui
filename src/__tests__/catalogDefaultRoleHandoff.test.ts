import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { prepareCatalogProject } from '@/services/catalogProjectHandoff'
import { buildProjectFiles, buildPushArgs } from '@/composables/useProjectGitSync'
import { loadGitProject, prepareGitProjectImport } from '@/services/gitProjectOpen'
import { useInventoryStore } from '@/stores/inventoryStore'
import type { GitProviderV1 } from '@/services/git/types'
import fixture from './fixtures/catalogRoleNtp.json'
const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
vi.mock('@/services/git', () => ({ getProvider }))
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

describe('actual default catalog role handoff', () => {
  it.each(['github', 'gitlab', 'gitea'] as const)('imports all seven pinned service.reload.ntp files and saves/reopens them through %s without changing their naming or bytes', async providerKind => {
    const source = { id: 'original', provider: providerKind, base_url: 'https://git.example', auth: { kind: 'none' as const },
      repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }
    const binding = { source_id: 'destination', provider: providerKind, base_url: 'https://git.example', repo_owner: 'me', repo_name: 'work',
      branch_strategy: 'shared_repo_subdir' as const, subdir: 'projects/ntp', branch: 'main', fork_policy: 'upstream' as const }
    const targetSha = 'b'.repeat(40)
    const originProvider = { listTree: vi.fn(async () => fixture.tree), getFileContent: vi.fn(async ({ path }) => ({
      content: fixture.files[path as keyof typeof fixture.files], sha: fixture.tree.find(item => item.path === path)!.sha,
    })) } as unknown as GitProviderV1
    const destination = { canWrite: vi.fn(async () => true), listTree: vi.fn(async () => []), listCommits: vi.fn(async ({ ref }) => {
      if (ref.startsWith('range42-ui/')) throw Object.assign(new Error('Missing'), { status: 404 })
      return [{ sha: targetSha }]
    }) } as unknown as GitProviderV1
    const preview = await prepareCatalogProject({ source, binding, projectId: 'role-copy', mode: 'customize',
      entry: { source_id: source.id, kind: 'ansible_role', name: 'service.reload.ntp', path: fixture.path, sha: fixture.sha } }, destination, originProvider)
    expect(preview.role).toBe(true)
    expect(preview.project.files).toEqual(fixture.files)
    expect(Object.keys(preview.project.files)).toHaveLength(7)
    const published = buildProjectFiles(buildPushArgs(preview.project, [], [])!)
    for (const [path, content] of Object.entries(fixture.files)) expect(published[path]).toBe(content)
    const provider = { listCommits: vi.fn(async () => [{ sha: targetSha }]), getFileContent: vi.fn(async ({ path }) => {
      const relative = path.replace(/^projects\/ntp\//, '')
      if (!(relative in published)) throw Object.assign(new Error('Missing'), { status: 404 })
      return { content: published[relative], sha: 'blob' }
    }) }
    getProvider.mockReturnValue(provider)
    useInventoryStore().addSource({ ...source, id: binding.source_id })
    const reopened = prepareGitProjectImport(await loadGitProject(preview.project.git, []))
    expect(reopened.files).toEqual(fixture.files)
    expect(reopened.catalogRef).toMatchObject({ kind: 'ansible_role', repo_owner: 'range42', path: fixture.path, sha: fixture.sha })
    expect(reopened.git.repo_owner).toBe('me')
  })
})

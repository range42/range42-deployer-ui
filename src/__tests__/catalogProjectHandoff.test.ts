import { describe, expect, it, vi } from 'vitest'
import { prepareCatalogProject } from '@/services/catalogProjectHandoff'
import type { GitProviderV1 } from '@/services/git/types'

const sha = 'a'.repeat(40)
const source = { id: 'public', provider: 'github' as const, base_url: 'https://github.com', auth: { kind: 'none' as const }, writable: false,
  repos: [{ owner: 'range42', repo: 'catalog', branch: 'main' }] }
const entry = { name: 'Example', kind: 'lab', source_id: 'public', path: 'labs/example', sha,
  document: { schema_version: '1.0', kind: 'lab', name: 'Example', nodes: [
    { id: 'network', kind: 'network', config: { subnet: '10.20.0.0/24' } },
    { id: 'vm', kind: 'vm', template_vmid: 9901, config: { cores: 2 }, networks: [{ node_ref: 'network', ip: '10.20.0.2' }] },
  ], env: [{ name: 'PASSWORD', secret: true, default: 'private-value' }] } }
const binding = { source_id: 'private', provider: 'github' as const, base_url: 'https://github.com', repo_owner: 'me', repo_name: 'work',
  branch: 'main', branch_strategy: 'shared_repo_subdir' as const, subdir: 'projects/example', fork_policy: 'auto' as const }
function provider() {
  return { canWrite: vi.fn().mockResolvedValue(true), listCommits: vi.fn(async ({ ref }) => {
    if (ref.startsWith('range42-ui/')) throw Object.assign(new Error('Not found'), { status: 404 })
    return [{ sha: 'b'.repeat(40) }]
  }), listTree: vi.fn().mockResolvedValue([]), ensureFork: vi.fn(), createBranch: vi.fn(), putFile: vi.fn() } as unknown as GitProviderV1
}
const prepare = (overrides = {}, git = provider()) => prepareCatalogProject({ entry, source, binding, mode: 'customize', projectId: 'project_demo', ...overrides }, git)

describe('catalog to writable project handoff', () => {
  it('loads the supported topology and secret declarations, preserving origin apart from a pinned dedicated working binding', async () => {
    const git = provider()
    const result = await prepare({}, git)
    expect(result.project.nodes).toHaveLength(2)
    expect(result.project.edges[0]).toMatchObject({ source: 'vm', target: 'network', data: { connection: { ipAddress: '10.20.0.2' } } })
    expect(result.project.baseDoc.env).toEqual([{ name: 'PASSWORD', secret: true }])
    expect(result.project.git).toMatchObject({ repo_owner: 'me', repo_name: 'work', working_branch: 'range42-ui/project_demo', branch_from: 'b'.repeat(40) })
    expect(result.project.catalogRef).toMatchObject({ mode: 'customize', source_id: 'public', repo_owner: 'range42', repo_name: 'catalog', path: entry.path, sha })
    expect(git.listTree).toHaveBeenCalledWith(expect.objectContaining({ ref: 'b'.repeat(40) }))
    expect(git.createBranch).not.toHaveBeenCalled()
    expect(git.ensureFork).not.toHaveBeenCalled()
    expect(git.putFile).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('private-value')
  })
  it('allows an explicit pending fork for a read-only destination, but refuses an upstream-only write', async () => {
    const git = provider(); vi.mocked(git.canWrite).mockResolvedValue(false)
    expect((await prepare({}, git)).pendingFork).toBe(true)
    await expect(prepare({ binding: { ...binding, fork_policy: 'upstream' } }, git)).rejects.toThrow(/write access/i)
  })
  it('rejects occupied project subdirectories and existing working branches without mutations', async () => {
    const git = provider(); vi.mocked(git.listTree).mockResolvedValue([{ path: 'projects/example/meta.json', type: 'blob', sha }])
    await expect(prepare({}, git)).rejects.toThrow(/already contains/i)
    vi.mocked(git.listTree).mockResolvedValue([])
    vi.mocked(git.listCommits).mockResolvedValue([{ sha, message: '', author: '', date: '' }])
    await expect(prepare({}, git)).rejects.toThrow(/working branch.*exists/i)
  })
  it('does not treat authentication failures as absent working branches', async () => {
    const git = provider(); vi.mocked(git.listCommits).mockRejectedValue(Object.assign(new Error('Access denied'), { status: 401 }))
    await expect(prepare({}, git)).rejects.toThrow('Access denied')
  })
  it.each(['container', 'bundle'])('explains unsupported %s items without creating an empty project', async kind => {
    await expect(prepare({ entry: { ...entry, kind, document: { name: 'Unsupported' } } })).rejects.toThrow(/range42.yaml/i)
  })
  it('preserves inline executable attachments and blocks unresolved file references by name', async () => {
    const item = structuredClone(entry)
    Object.assign(item.document.nodes[1], { attachments: [{ id: 'inline', source: { kind: 'inline_yaml', content_inline: '- debug:\n    msg: hello' }, stage: 'configure' }] })
    expect((await prepare({ entry: item })).project.attachments[0].source.content_inline).toContain('hello')
    Object.assign(item.document.nodes[1], { attachments: [{ source: { kind: 'file_upload', content_ref: 'files/tool.bin' }, stage: 'configure' }] })
    await expect(prepare({ entry: item })).rejects.toThrow(/files\/tool.bin/)
  })
  it('rejects execution/defaults that the editable canvas cannot preserve instead of dropping behavior', async () => {
    await expect(prepare({ entry: { ...entry, document: { ...entry.document, execution: { stages: ['special'] } } } })).rejects.toThrow(/execution/)
    const item = structuredClone(entry)
    Object.assign(item.document.nodes[0], { cidr_template: '10.{{ team }}.0.0/24' })
    await expect(prepare({ entry: item })).rejects.toThrow(/cidr_template/)
  })
  it('requires an exact source SHA and unambiguous source repository', async () => {
    await expect(prepare({ entry: { ...entry, sha: 'abc' } })).rejects.toThrow(/exact.*SHA/i)
    await expect(prepare({ source: { ...source, repos: [...source.repos, source.repos[0]] } })).rejects.toThrow(/one repository/i)
  })
})

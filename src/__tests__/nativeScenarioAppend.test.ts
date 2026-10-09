import { describe, expect, it } from 'vitest'
import { prepareCatalogAppend } from '@/services/catalogProjectAppend'
import { captureCanvasSnapshot, readCanvasSnapshot } from '@/services/projectCanvasSnapshot'
import { platformSelection, isPlatformResource } from '@/services/platformComponents'
import { catalogCapabilities } from '@/services/catalogPresentation'
import type { CatalogEntry } from '@/composables/useCatalog'
import type { GitSource } from '@/stores/inventoryStore'
import type { ProjectDraft } from '@/types/project'
import type { NativeTopology } from '@/services/nativeScenarioCanvas'
import { buildProjectFiles, buildPushArgs } from '@/composables/useProjectGitSync'

const source = { id: 'playbooks', provider: 'github', base_url: 'https://github.com', repos: [{ owner: 'range42', repo: 'playbooks', branch: 'main' }] } as GitSource
const entry = (): CatalogEntry => ({ source_id: source.id, path: 'scenarios/demo', sha: 'a'.repeat(40), kind: 'scenario', name: 'demo', document: {
  format: 'range42-native', features: [{ id: 'MONITORING', default: false }], topology: {
    vms: [{ vm_id: 2001, vm_name: 'web', bridge: 'net42', ip: '10.42.0.10', role: 'admin' }, { vm_id: 2002, vm_name: 'client', bridge: 'net43', ip: '10.43.0.10' }],
    templates: [{ vm_id: 9901, vm_name: 'ubuntu' }], networks: [{ vnet: 'net42', subnet: '10.42.0.0/24', gateway: '10.42.0.1' }, { vnet: 'net43' }],
    warnings: ['Diagram contains all declared resources.'], reservations: { status: 'checked', issues: [] },
  },
} })
const project = (): ProjectDraft => ({ id: 'project', name: 'Existing project', nodes: [{ id: 'existing', type: 'vm', position: { x: 0, y: 0 }, data: { config: { vmid: 3000 } } }], edges: [], files: { 'my-file.yml': 'keep' }, attachments: [] })

describe('existing scenarios on the canvas', () => {
  it('enables scenario addition from the catalog', () => {
    expect(catalogCapabilities('scenario').append).toBe(true)
  })
  it('appends real nodes and networks, preserving the project and the pinned source', async () => {
    const original = project(), before = JSON.stringify(original)
    const result = await prepareCatalogAppend({ entry: entry(), source, project: original })
    expect(JSON.stringify(original)).toBe(before)
    expect(result.project.files).toEqual(original.files)
    expect(result.project.nodes.filter(node => node.type === 'vm')).toHaveLength(3)
    expect(result.project.nodes.filter(node => node.type === 'network-segment')).toHaveLength(2)
    const group = result.project.nodes.find(node => node.data?.config?.nativeCatalog)!
    expect(group.type).toBe('group')
    expect(platformSelection(group)).toEqual({ version: 1, path: 'scenarios/demo', component_id: group.id })
    expect(group.data?.config?.nativeCatalog).toMatchObject({ sha: 'a'.repeat(40), repo_name: 'playbooks', source_id: 'playbooks' })
    const canvas = readCanvasSnapshot(captureCanvasSnapshot(result.project), [])
    expect(canvas.nodes.filter(isPlatformResource).length).toBe(result.addedNodeIds.length)
    expect(canvas.edges).toHaveLength(2)
    expect(canvas.edges[0]?.data?.connection?.ipAddress).toBe('10.42.0.10/24')
    expect(result.warnings).toContain('Diagram contains all declared resources.')
  })
  it.each(['nodes', 'edges'] as const)('rejects an append that exceeds the combined %s limit without changing the project', async kind => {
    const original = project()
    original.nodes = Array.from({ length: kind === 'nodes' ? 1020 : 2 }, (_, i) => ({ id: `existing-${i}`, type: 'note', position: { x: 0, y: 0 } }))
    if (kind === 'edges') original.edges = Array.from({ length: 4095 }, (_, i) => ({ id: `edge-${i}`, source: 'existing-0', target: 'existing-1' }))
    const before = JSON.stringify(original)
    await expect(prepareCatalogAppend({ entry: entry(), source, project: original })).rejects.toThrow(/canvas|limit|large|many/i)
    expect(JSON.stringify(original)).toBe(before)
  })
  it('rejects VMID reuse even when the scenario is added a second time', async () => {
    const first = await prepareCatalogAppend({ entry: entry(), source, project: project() })
    await expect(prepareCatalogAppend({ entry: entry(), source, project: first.project })).rejects.toThrow(/VMID|already/)
  })
  it('permits a shared network, but rejects a duplicate address on that network', async () => {
    const original = project()
    original.nodes.push({ id: 'net', type: 'network-segment', data: { config: { vnet: 'net42', cidr: '10.42.0.0/24' } } })
    await expect(prepareCatalogAppend({ entry: entry(), source, project: original })).resolves.toBeDefined()
    original.edges.push({ id: 'connection', source: 'existing', target: 'net', data: { connection: { ipAddress: '10.42.0.10/24' } } })
    await expect(prepareCatalogAppend({ entry: entry(), source, project: original })).rejects.toThrow(/address/i)
  })
  it('blocks conflicts reported by the registry', async () => {
    const item = entry()
    ;(item.document!.topology as NativeTopology).reservations = { status: 'conflict', issues: ['VMID 2001 conflicts with other'] }
    await expect(prepareCatalogAppend({ entry: item, source, project: project() })).rejects.toThrow(/2001/)
  })
  it('keeps a zero-VM diagnostic scenario without inventing machines', async () => {
    const item = entry()
    ;(item.document!.topology as NativeTopology).vms = []
    const result = await prepareCatalogAppend({ entry: item, source, project: project() })
    expect(result.project.nodes.filter(node => node.type === 'vm')).toHaveLength(1)
  })
  it('saves source identity in the project commit without copying the native workflow', async () => {
    const result = await prepareCatalogAppend({ entry: entry(), source, project: project() })
    result.project.git = { source_id: 'mine', provider: 'github', base_url: 'https://github.com', repo_owner: 'me', repo_name: 'project', branch: 'main', branch_strategy: 'dedicated_repo' }
    const files = buildProjectFiles(buildPushArgs(result.project, result.project.nodes, result.project.edges)!)
    const group = JSON.parse(files['canvas_layout.json'] as string).ui_canvas.nodes.find((node: { id: string }) => node.id === 'catalog-1')
    expect(group.data.config.nativeCatalog.sha).toBe(entry().sha)
    expect(Object.keys(files).some(path => path.startsWith('scenarios/demo/'))).toBe(false)
  })
  it('rejects a scenario template VMID occupied by an existing project VM', async () => {
    const original = project()
    original.nodes[0]!.data!.config!.vmid = 9901
    await expect(prepareCatalogAppend({ entry: entry(), source, project: original })).rejects.toThrow(/9901/)
  })
})

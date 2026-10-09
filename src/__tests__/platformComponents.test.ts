import { expect, it } from 'vitest'
import { captureCanvasSnapshot, readCanvasSnapshot } from '@/services/projectCanvasSnapshot'
import type { ProjectDraft } from '@/types/project'
const load = async () => await import('@/services/platformComponents').catch(() => ({})) as typeof import('@/services/platformComponents')
const component = () => ({ version: 1 as const, scenario: { version: 1 as const, path: 'platforms/alpha' },
  plan: { id: 'alpha', profile: 'core', domain: 'alpha.example.test', bridge: 'r42alpha', subnet: '10.81.0.0/24', gateway: '10.81.0.1',
    vms: [{ service: 'ui', vm_id: 31000, vm_name: 'r42-alpha-ui', ip: '10.81.0.12', template_vmid: 9221 }] },
  files: { 'platforms/alpha/main.yml': '- hosts: all\n  tasks: []\n', 'platforms/alpha/manifest/stack.json': '{}',
    'platform_runtime/bundles/test.yml': 'fixture' } })
it.each([false, true])('appends a deployable component while preserving existing=%s canvas, files and identity', async existing => {
  const api = await load(); expect(api.appendPlatformComponent).toBeTypeOf('function')
  const project: ProjectDraft = { id: 'same-project', name: 'Lab', nodes: existing ? [{ id: 'old', type: 'vm' }] : [], edges: [], attachments: [],
    files: { 'content/keep.txt': 'keep' }, git: { repo_name: 'original' } as never }
  const before = JSON.stringify(project)
  const result = api.appendPlatformComponent(project, component())
  expect(JSON.stringify(project)).toBe(before)
  expect(result.id).toBe(project.id); expect(result.git).toEqual(project.git)
  expect(result.nodes.slice(0, project.nodes.length)).toEqual(project.nodes)
  expect(result.files?.['content/keep.txt']).toBe('keep')
  expect(result.native_scenario).toBeUndefined()
  const restored = readCanvasSnapshot(captureCanvasSnapshot(result), result.attachments)
  expect(api.platformSelection(restored.nodes.find(n => n.type === 'group')!)).toEqual(component().scenario)
})
it('rejects collisions without overwriting files or allocating duplicate VMIDs', async () => {
  const api = await load(); expect(api.appendPlatformComponent).toBeTypeOf('function')
  const project: ProjectDraft = { id: 'p', name: 'Lab', nodes: [], edges: [], attachments: [], files: { 'platform_runtime/bundles/test.yml': 'edited' } }
  expect(() => api.appendPlatformComponent(project, component())).toThrow(/already exists/)
  project.files = {}; project.scenario = { vms: [{ vm_id: 31000 }] }
  expect(() => api.appendPlatformComponent(project, component())).toThrow(/VMID/)
  project.scenario = { networks: [{ subnet: '10.81.0.0/25', vnet: 'different' }] }
  expect(() => api.appendPlatformComponent(project, component())).toThrow(/overlap/)
})

it('renders each service and its network as connected children and expands legacy stack cards', async () => {
  const api=await load(), c=component()
  const result=api.appendPlatformComponent({id:'p',name:'Lab',nodes:[],edges:[],attachments:[]},c)
  const group=result.nodes.find(n=>n.type==='group')!
  const services=result.nodes.filter(n=>n.type==='vm')
  expect(services).toHaveLength(c.plan.vms.length)
  expect(services[0]?.parentNode).toBe(group.id)
  expect(services[0]?.data?.config?.vmid).toBe(31000)
  const network=result.nodes.find(n=>n.type==='network-segment')!
  expect(network.data?.config?.cidr).toBe(c.plan.subnet)
  expect(network.data?.config).toMatchObject({ bridge: c.plan.bridge, segmentType: 'management', platformStack: group.id })
  expect(services[0]?.data?.config).toMatchObject({ template: 9221, ipAddress: '10.81.0.12', platformStack: group.id })
  expect(group.data).toMatchObject({ type: 'group', kind: 'topology_group', hasChildren: true })
  expect(result.edges).toEqual([expect.objectContaining({ type: 'network', source: services[0]!.id, target: network.id,
    targetHandle: 'top-1', data: { useDhcp: false, connection: expect.objectContaining({ interfaceName: 'net0', ipAddress: '10.81.0.12/24' }) } })])
  const restored=readCanvasSnapshot(captureCanvasSnapshot(result),[])
  expect(restored.nodes).toHaveLength(3);expect(restored.edges).toHaveLength(1)
  expect(typeof api.expandPlatformCanvas).toBe('function')
  const expanded=api.expandPlatformCanvas([group],[])
  expect(expanded.nodes).toHaveLength(3)
  expect(api.expandPlatformCanvas(expanded.nodes,expanded.edges).nodes).toHaveLength(3)
})

it('removes a stack and all its generated service nodes as one component', async () => {
  const api=await load(), {removeCanvasNode}=await import('@/services/canvasDeletion')
  const result=api.appendPlatformComponent({id:'p',name:'Lab',nodes:[{id:'keep',type:'vm'}],edges:[],attachments:[]},component())
  const removed=removeCanvasNode(result.nodes,result.edges,'platform-alpha')
  expect(removed.nodes.map(n=>n.id)).toEqual(['keep'])
  expect(removed.edges).toEqual([])
})

it('migrates old stack cards and resource cards without losing saved positions or mutating the source', async () => {
  const api = await load(), c = component()
  const original = [
    { id: 'platform-alpha', type: 'range42-stack', position: { x: 500, y: 120 }, data: { config: { name: 'My stack', scenario: c.scenario, plan: c.plan } } },
    { id: 'platform-alpha-ui', type: 'platform-vm', parentNode: 'platform-alpha', position: { x: 75, y: 330 }, data: { config: c.plan.vms[0] } },
    { id: 'platform-alpha-network', type: 'platform-network', parentNode: 'platform-alpha', position: { x: 400, y: 150 } },
  ]
  const edges = [{ id: 'platform-alpha-network-platform-alpha-ui', type: 'smoothstep', source: 'platform-alpha-network', target: 'platform-alpha-ui' }]
  const before = JSON.stringify({ nodes: original, edges })
  const migrated = api.expandPlatformCanvas(original, edges)
  expect(migrated.nodes.map(n => n.type)).toEqual(['group', 'vm', 'network-segment'])
  expect(migrated.nodes.map(n => n.position)).toEqual(original.map(n => n.position))
  expect(migrated.edges[0]?.type).toBe('network')
  expect(JSON.stringify({ nodes: original, edges })).toBe(before)
  expect(api.expandPlatformCanvas(migrated.nodes, migrated.edges)).toEqual(migrated)
  const reopened = api.expandPlatformCanvas(readCanvasSnapshot(captureCanvasSnapshot({ ...migrated, attachments: [] }), []).nodes, migrated.edges)
  expect(api.platformSelection(reopened.nodes[0]!)).toEqual(c.scenario)
  expect(reopened.nodes[0]?.data?.hasChildren).toBe(true)
})

it('wraps a full stack into a readable canvas group instead of one very wide row', async () => {
  const api = await load(), c = component()
  c.plan.vms = Array.from({ length: 11 }, (_, i) => ({ ...c.plan.vms[0]!, service: `service${i}`, vm_id: 31000 + i, vm_name: `service${i}` }))
  const { nodes } = api.appendPlatformComponent({ id: 'p', name: 'Lab', nodes: [], edges: [], attachments: [] }, c)
  const group = nodes.find(n => n.type === 'group')!
  expect(parseInt((group.style as { width: string }).width)).toBeLessThanOrEqual(2100)
  expect(new Set(nodes.filter(n => n.type === 'vm').map(n => n.position!.y)).size).toBeGreaterThan(1)
})

it('reflows an untouched legacy grid so the taller standard network card clears its VMs', async () => {
  const api = await load(), c = component()
  const legacy = [
    { id: 'platform-alpha', type: 'range42-stack', position: { x: 0, y: 80 }, data: { config: { name: 'Alpha', plan: c.plan, scenario: c.scenario } } },
    { id: 'platform-alpha-network', type: 'platform-network', parentNode: 'platform-alpha', position: { x: 345, y: 140 } },
    { id: 'platform-alpha-ui', type: 'platform-vm', parentNode: 'platform-alpha', position: { x: 30, y: 285 } },
  ]
  const migrated = api.expandPlatformCanvas(legacy, [])
  const fresh = api.appendPlatformComponent({ id: 'p', name: 'P', nodes: [], edges: [], attachments: [] }, c)
  expect(migrated.nodes.map(n => n.position)).toEqual(fresh.nodes.map(n => n.position))
})

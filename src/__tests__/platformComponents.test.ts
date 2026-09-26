import { expect, it } from 'vitest'
import { captureCanvasSnapshot, readCanvasSnapshot } from '@/services/projectCanvasSnapshot'
import type { ProjectDraft } from '@/types/project'
const load = async () => await import('@/services/platformComponents').catch(() => ({})) as typeof import('@/services/platformComponents')
const component = () => ({ version: 1 as const, scenario: { version: 1 as const, path: 'platforms/alpha' },
  plan: { id: 'alpha', profile: 'core', domain: 'alpha.example.test', bridge: 'r42alpha', subnet: '10.81.0.0/24',
    vms: [{ service: 'ui', vm_id: 31000, vm_name: 'r42-alpha-ui' }] },
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
  expect(api.platformSelection(restored.nodes.find(n => n.type === 'range42-stack')!)).toEqual(component().scenario)
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
  const group=result.nodes.find(n=>n.type==='range42-stack')!
  const services=result.nodes.filter(n=>n.type==='platform-vm')
  expect(services).toHaveLength(c.plan.vms.length)
  expect(services[0]?.parentNode).toBe(group.id)
  expect(services[0]?.data?.config?.vm_id).toBe(31000)
  const network=result.nodes.find(n=>n.type==='platform-network')!
  expect(network.data?.config?.subnet).toBe(c.plan.subnet)
  expect(result.edges).toEqual([expect.objectContaining({source:network.id,target:services[0]!.id})])
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

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
  expect(result.nodes.slice(0, -1)).toEqual(project.nodes)
  expect(result.files?.['content/keep.txt']).toBe('keep')
  expect(result.native_scenario).toBeUndefined()
  const restored = readCanvasSnapshot(captureCanvasSnapshot(result), result.attachments)
  expect(api.platformSelection(restored.nodes.at(-1)!)).toEqual(component().scenario)
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

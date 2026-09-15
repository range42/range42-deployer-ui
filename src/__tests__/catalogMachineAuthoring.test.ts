import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildCatalogMachine } from '@/services/catalogMachineAuthoring'
import { catalogCanvas } from '@/services/catalogProjectHandoff'
import { createScenarioDraft } from '@/services/concreteScenario'

const input = { category: 'systems', target: 'ubuntu_24_04', description: 'Ubuntu cloud-init guest',
  tags: 'linux, ubuntu, linux', os: 'Ubuntu 24.04 LTS', cores: 2, memory_mb: 2048, disk_gb: 20,
  template_vmid: '', storage: '' }

describe('catalog machine authoring', () => {
  it('creates a portable VM blueprint whose resources and SDN link survive project import', () => {
    const draft = buildCatalogMachine(input)
    expect(draft.path).toBe('05_topology_layer/box_templates/systems.clone.ubuntu_24_04/v1.0.0')
    const document = parse(draft.files[`${draft.path}/range42.yaml`])
    const { canvas } = catalogCanvas({ kind: 'component', name: draft.name, source_id: 'public', path: draft.path, document })
    const scenario = createScenarioDraft({ name: draft.name }, canvas.nodes, canvas.edges)
    expect(scenario.network_mode).toBe('sdn')
    expect(scenario.vms).toEqual([expect.objectContaining({ cores: 2, memory_mb: 2048, disk_gb: 20,
      vm_id: '', template_vm_id: '', network_id: 'network' })])
    expect(document.tags).toEqual(['linux', 'ubuntu'])
    expect(draft.files[`${draft.path}/README.md`]).toContain('Ubuntu 24.04 LTS')
    expect(JSON.stringify(document)).not.toMatch(/9901|62000|target_host_id/)
  })

  it('preserves optional local template and storage preferences without creating runtime identity', () => {
    const draft = buildCatalogMachine({ ...input, template_vmid: '9123', storage: 'local-zfs' })
    const document = parse(draft.files[`${draft.path}/range42.yaml`])
    expect(document.nodes[0].template_vmid).toBe(9123)
    expect(document.nodes[0].config.storage).toBe('local-zfs')
    expect(document.nodes[0].config).not.toHaveProperty('vmid')
    expect(() => catalogCanvas({ kind: 'component', name: draft.name, source_id: 'private', path: draft.path, document })).not.toThrow()
  })

  it.each([
    ['category', '../x'], ['target', 'Bad name'], ['target', ''], ['description', ''], ['os', ''],
    ['cores', 0], ['cores', 1.5], ['memory_mb', 64], ['disk_gb', 0], ['template_vmid', 99],
    ['template_vmid', '1e3'], ['storage', '../pool'],
  ])('rejects invalid %s before generating paths or files', (field, value) => {
    expect(() => buildCatalogMachine({ ...input, [field]: value })).toThrow()
  })

  it('refuses a directory collision and preserves an unrelated similarly named component', () => {
    expect(() => buildCatalogMachine(input, ['05_topology_layer/box_templates/systems.clone.ubuntu_24_04/v1.0.0/README.md'])).toThrow(/already exists/)
    expect(() => buildCatalogMachine(input, ['05_topology_layer/box_templates/systems.clone.ubuntu_24_04_extra/v1.0.0/README.md'])).not.toThrow()
  })
})

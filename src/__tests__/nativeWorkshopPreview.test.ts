import { expect, it } from 'vitest'
import * as native from '@/services/nativeScenarioCanvas'

const path = 'scenarios/install-workshop'
const files = {
  [`${path}/manifest/scenario_vms.json`]: JSON.stringify({ vms: [
    { vm_id: 43010, vm_name: 'user01-pve', bridge: 'vmbr430', ip: '10.77.32.2', cores: 4, memory_mib: 16384, disk_gib: 160 },
    { vm_id: 43020, vm_name: 'user06-pve', bridge: 'vmbr435', ip: '10.77.32.82', requires_features: ['EXTRA_SEATS'] },
  ], templates: [] }),
  [`${path}/manifest/scenario_networks.json`]: JSON.stringify({ networks: [
    { vnet: 'vmbr430', subnet: '10.77.32.0/28', gateway: '10.77.32.1' },
    { vnet: 'vmbr435', subnet: '10.77.32.80/28', gateway: '10.77.32.81' },
  ] }),
  [`${path}/manifest/feature_flags.yml`]: 'features:\n- id: EXTRA_SEATS\n  label: Ten participants\n  default: false\n',
}

it('builds a native project preview from its pinned files without provider reads', () => {
  expect(native.nativePreviewFromFiles).toBeTypeOf('function')
  const preview = native.nativePreviewFromFiles(files, path)
  expect(preview.topology.vms).toHaveLength(2)
  expect(preview.topology.networks[0].subnet).toBe('10.77.32.0/28')
  expect(preview.features).toEqual([{ id: 'EXTRA_SEATS', label: 'Ten participants', default: false }])
})

it('previews only the selected feature resources and keeps networks isolated', () => {
  expect(native.selectNativeTopology).toBeTypeOf('function')
  const preview = native.nativePreviewFromFiles(files, path)
  const five = native.selectNativeTopology(preview.topology, {})
  expect(five.vms.map(vm => vm.vm_id)).toEqual([43010])
  expect(five.networks.map(net => net.vnet)).toEqual(['vmbr430'])
  const ten = native.selectNativeTopology(preview.topology, { EXTRA_SEATS: true })
  expect(ten.vms).toHaveLength(2)
  const graph = native.nativeScenarioCanvas('preview', 'Installation workshop', path, ten)
  expect(graph.edges.every(edge => graph.nodes.find(node => node.id === edge.source)?.data.config.bridge
    === graph.nodes.find(node => node.id === edge.target)?.data.config.bridge)).toBe(true)
  expect(graph.nodes.find(node => node.id === 'preview-vm-43010')?.data.config.cores).toBe(4)
})

it('retains typed workshop intent for the project preview before any VMs are allocated',()=>{
  const descriptor={version:1,kind:'native-installation',title:'Install Range42',min_seats:1,max_seats:10}
  const dynamic={...files,[`${path}/manifest/scenario_vms.json`]:JSON.stringify({version:2,vms:[]}),[`${path}/manifest/workshop.json`]:JSON.stringify(descriptor)}
  expect(native.nativePreviewFromFiles(dynamic,path)).toMatchObject({workshop:descriptor,topology:{vms:[]}})
})

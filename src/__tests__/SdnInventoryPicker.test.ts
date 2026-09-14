import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import SdnInventoryPicker from '@/components/project/SdnInventoryPicker.vue'
const api = vi.hoisted(() => ({ hosts: vi.fn(), zones: vi.fn(), vnets: vi.fn(), subnets: vi.fn(), guard: vi.fn() }))
vi.mock('@/services/sdnInventory', () => ({ createSdnInventoryClient: () => api }))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia()); useBackendApiStore().addHost({ url: 'https://backend.test' })
  Object.values(api).forEach(mock => mock.mockReset())
  api.hosts.mockResolvedValue([{ id: 'host', name: 'Range host', node_name: 'pve01' }])
  api.zones.mockResolvedValue([{ zone: 'lab', type: 'simple', nodes: [], state: null, has_pending: false }])
  api.vnets.mockResolvedValue([{ vnet: 'training', zone: 'lab', state: null, has_pending: false }])
  api.subnets.mockResolvedValue([{ subnet: 'lab-10.1.2.0-24', vnet: 'training', cidr: '10.1.2.0/24', gateway: '10.1.2.1', snat: false, state: null, has_pending: false }])
})
afterEach(() => wrapper?.unmount())
async function choose() {
  wrapper = mount(SdnInventoryPicker, { props: { networks: [{ id: 'net1', vnet: 'existing-draft-name' }] } })
  expect(api.hosts).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="sdn-load"]').trigger('click'); await flushPromises()
  await wrapper.get('[name="sdn-host"]').setValue('host'); await flushPromises()
  await wrapper.get('[name="sdn-zone"]').setValue('lab'); await flushPromises()
  await wrapper.get('[name="sdn-vnet"]').setValue('training'); await flushPromises()
  await wrapper.get('[name="sdn-subnet"]').setValue('lab-10.1.2.0-24'); await flushPromises()
}
describe('SDN planning picker', () => {
  it('explains when a reserved deployment host is absent from the current registry', async () => {
    wrapper = mount(SdnInventoryPicker, { props: { networks: [], initialHostId: 'missing' } })
    await wrapper.get('[data-testid="sdn-load"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('The reserved deployment host is unavailable')
    expect(api.zones).not.toHaveBeenCalled()
  })
  it('requires explicit source selection and confirmation before copying network values into the draft', async () => {
    await choose()
    expect(wrapper.emitted('selected')).toBeUndefined()
    await wrapper.get('[name="sdn-draft-network"]').setValue('net1')
    await wrapper.get('[data-testid="sdn-use"]').trigger('click')
    expect(wrapper.emitted('selected')![0][0]).toEqual({ host_id: 'host', backend_url: 'https://backend.test', zone: 'lab', network_id: 'net1', vnet: 'training', subnet: '10.1.2.0/24', gateway: '10.1.2.1', snat: false })
  })
  it('disables pending, incompatible-node and non-Simple zones', async () => {
    api.zones.mockResolvedValue([{ zone: 'lab', type: 'simple', nodes: [], state: 'changed', has_pending: true }, { zone: 'other', type: 'simple', nodes: ['pve02'], state: null, has_pending: false }, { zone: 'vlan', type: 'vlan', nodes: [], state: null, has_pending: false }])
    wrapper = mount(SdnInventoryPicker, { props: { networks: [{ id: 'net1', vnet: '' }] } })
    await wrapper.get('[data-testid="sdn-load"]').trigger('click'); await flushPromises()
    await wrapper.get('[name="sdn-host"]').setValue('host'); await flushPromises()
    const options = wrapper.findAll('[name="sdn-zone"] option').slice(1)
    expect(options).toHaveLength(3)
    expect(options.every(option => (option.element as HTMLOptionElement).disabled)).toBe(true)
  })
  it('clears a reviewed selection after backend changes and refuses confirmation', async () => {
    await choose()
    const backend = useBackendApiStore(); backend.updateHost(backend.activeHost!.id, { token: 'changed' }); await flushPromises()
    expect(wrapper.find('[data-testid="sdn-use"]').exists()).toBe(false)
    expect(wrapper.emitted('selected')).toBeUndefined()
  })
})

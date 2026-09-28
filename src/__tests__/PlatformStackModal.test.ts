import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { flushPromises, mount } from '@vue/test-utils'
import PlatformStackModal from '@/components/project/PlatformStackModal.vue'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/services/backendApi', () => ({ backendRequest: request, getBackendScope: () => 'fixture' }))
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); useBackendApiStore().addHost({url:'fixture',token:'test'}); request.mockReset() })
it('requires a review before adding and invalidates it when stack settings change', async () => {
  const component = { version: 1, plan: { id: 'alpha', domain: 'alpha.example.test', profile: 'core', bridge: 'r42alpha', subnet: '10.81.0.0/24', vms: [{ vm_id: 31000, vm_name: 'r42-alpha-ui', service: 'ui' }] }, scenario: { version: 1, path: 'platforms/alpha' }, files: {} }
  request.mockImplementation(async path => {
    if (path.startsWith('/v1/proxmox/hosts?')) return { items: [{ id: 'host', name: 'PVE', node_name: 'pve01' }], total: 1, offset: 0, limit: 100 }
    if (path.endsWith('/vms')) return { items: [{ vmid: 9221, name: 'Template', type: 'qemu', template: true, node: 'pve01' }], total: 1 }
    if (path.includes('/sdn/vnets')) return { items: [], total: 0, offset: 0, limit: 100, view: 'pending', visibility: 'credential_filtered' }
    return component
  })
  const wrapper = mount(PlatformStackModal, { props: { project: { id: 'p', name: 'Lab', nodes: [], edges: [], attachments: [] } }, global: { stubs: { FocusTrap: { template: '<div><slot /></div>' } } } })
  try {
    await flushPromises()
    expect(wrapper.find('[data-testid="platform-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="platform-add"]').exists()).toBe(false)
    await wrapper.get('[name="id"]').setValue('alpha')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(request).toHaveBeenCalledWith('/v1/platform/components/preview', expect.objectContaining({ method: 'POST' }))
    expect(wrapper.get('[data-testid="platform-add"]').text()).toBe('Add stack to project')
    const backend = useBackendApiStore()
    backend.updateHost(backend.activeHost!.id, { health: { status: 'ok', ts: new Date().toISOString() } })
    await flushPromises()
    expect(wrapper.find('[data-testid="platform-add"]').exists()).toBe(true)
    await wrapper.setProps({ project: { ...wrapper.props('project'), name: 'Updated project display' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="platform-add"]').exists()).toBe(true)
    await wrapper.get('[name="domain"]').setValue('new.example.test')
    expect(wrapper.find('[data-testid="platform-add"]').exists()).toBe(false)
    expect(wrapper.emitted('add')).toBeUndefined()
  } finally { wrapper.unmount() }
})

it('selects a real template and suggests unused VM IDs and network settings', async () => {
  request.mockImplementation(async path => {
    if(path.startsWith('/v1/proxmox/hosts?')) return {items:[{id:'host',name:'PVE',node_name:'pve01'}],total:1,offset:0,limit:100}
    if(path.endsWith('/vms')) return {items:[{vmid:31000,name:'Ubuntu template',type:'qemu',template:true,node:'pve01'},{vmid:31001,name:'Guest',type:'qemu',template:false,node:'pve01'}],total:2,offset:0,limit:2}
    if(path.includes('/sdn/vnets')) return {items:[],total:0,offset:0,limit:100,view:'pending',visibility:'credential_filtered'}
    throw new Error('Unexpected request '+path)
  })
  const wrapper=mount(PlatformStackModal,{props:{project:{id:'p',name:'Lab',nodes:[],edges:[],attachments:[]}},global:{stubs:{FocusTrap:{template:'<div><slot /></div>'}}}})
  await flushPromises()
  expect(wrapper.find('select[name="template_vmid"]').exists()).toBe(true)
  const select=wrapper.get('select[name="template_vmid"]')
  expect(select.text()).toContain('Ubuntu template');expect(select.text()).not.toContain('Guest')
  await select.setValue('31000')
  expect(Number(wrapper.get('[name="vmid_start"]').element.value)).toBeGreaterThan(31001)
  expect(wrapper.get('[name="subnet"]').element.value).toBe('10.80.0.0/24')
  expect(wrapper.get('[name="gateway"]').element.value).toBe('10.80.0.1')
  expect(wrapper.get('[name="bridge"]').element.value).toBeTruthy()
  await wrapper.get('[name="profile"]').setValue('full')
  expect(wrapper.text()).toContain('11 VM IDs')
  wrapper.unmount()
})

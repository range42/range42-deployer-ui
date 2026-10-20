import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Settings from '@/views/Settings.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

const calls = vi.hoisted(() => ({ requests: [] as {path: string; body?: Record<string, unknown>}[], role: 'admin', deferRegister: false, releaseRegister: null as null | (() => void) }))
vi.mock('@/services/backendApi', () => ({
  getBackendScope: () => useBackendApiStore().activeHost?.url || '',
  backendRequest: async (path: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined
    calls.requests.push({path, body})
    if(path==='/v1/auth/me') return {role: calls.role}
    if(path==='/v1/proxmox/hosts' && options?.method==='POST') {
      if(calls.deferRegister) await new Promise<void>(resolve=>{calls.releaseRegister=resolve})
      return {id:'scoped', name:body.name, api_url:body.api_url, node_name:body.node_name, has_token:true}
    }
    if(path==='/v1/proxmox/hosts') return {items:[{id:'scoped', name:'Scoped provisioner', api_url:'https://pve.test:8006', node_name:'pve'}]}
    if(path==='/v1/environments/review') return {revision:'a'.repeat(64), ready_for_planning:true, infrastructure_qualified:false, workshop_profile:body.workshop_profile, requirements:['Live infrastructure preflight is required.']}
    if(path==='/v1/environments' && options?.method==='POST') return {id:'env-saved', label:body.label}
    return {items:[], base_contexts:[{id:'trusted', label:'Trusted native runtime', target_node:'pve', target_api_url:'https://pve.test:8006', ready:true, issues:[]}]}
  },
}))
let view: VueWrapper
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); calls.requests=[]; calls.role='admin';calls.deferRegister=false;calls.releaseRegister=null; useBackendApiStore().addHost({url:'https://backend.test', nodeName:'pve', token:'STAFF-ONLY-TEST-KEY'}) })
afterEach(() => view?.unmount())
async function show() {
  const router=createRouter({history:createMemoryHistory(), routes:[{path:'/:pathMatch(.*)*', component:Settings}]})
  await router.push('/settings?tab=connections')
  view=mount({template:'<RouterView />'}, {global:{plugins:[router]}})
  await flushPromises()
}

it('reviews human provisioning bounds and requires a fresh review after edits', async()=>{
  await show()
  expect(view.find('[data-testid="native-environments"]').exists()).toBe(true)
  expect(calls.requests).toHaveLength(0)
  await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click')
  for(const [key,value] of Object.entries({label:'Workshop provisioner', base_context_id:'trusted', target_host_id:'scoped', profile_id:'training', vmid_start:'45000', vmid_end:'45039', network_pool:'10.79.0.0/23', network_count:'20', bridge_start:'600', proxmox_template:'9240', deployer_template:'9241', storage:'ceph-range'})) await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  const request=calls.requests.find(row=>row.path==='/v1/environments/review')?.body
  expect(request?.workshop_profile).toMatchObject({vmid_ranges:[[45000,45039]], networks:expect.arrayContaining([{bridge:'vmbr600',subnet:'10.79.0.0/28',gateway:'10.79.0.1'},{bridge:'vmbr619',subnet:'10.79.1.48/28',gateway:'10.79.1.49'}])})
  expect(view.text()).toContain('Live infrastructure preflight')
  expect(view.get('[data-testid="save-native-environment"]').attributes('disabled')).toBeUndefined()
  await view.get('[data-testid="environment-storage"]').setValue('different-store')
  expect(view.find('[data-testid="save-native-environment"]').exists()).toBe(false)
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  await view.get('[data-testid="save-native-environment"]').trigger('click');await flushPromises()
  expect(calls.requests.filter(row=>row.path==='/v1/environments' && row.body)).toHaveLength(1)
  expect(view.text()).toContain('Environment registered')
})

it('registers a dedicated Proxmox target while clearing its credential from the form',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-environment-target"]').trigger('click')
  for(const [key,value] of Object.entries({name:'Workshop provisioner', api_url:'https://pve.test:8006', node_name:'pve', token_ref:'workshops@pve!scoped=PRIVATE-TARGET-TEST-KEY'}))await view.get(`[data-testid="environment-target-${key}"]`).setValue(value)
  await view.get('[data-testid="environment-target-form"]').trigger('submit');await flushPromises()
  expect(calls.requests.find(row=>row.path==='/v1/proxmox/hosts' && row.body)?.body).toMatchObject({name:'Workshop provisioner', token_ref:'workshops@pve!scoped=PRIVATE-TARGET-TEST-KEY'})
  expect(view.html()).not.toContain('PRIVATE-TARGET-TEST-KEY')
})

it('clears unsaved credentials and reviewed authority immediately when the backend changes',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-environment-target"]').trigger('click')
  await view.get('[data-testid="environment-target-token_ref"]').setValue('PRIVATE-TARGET-TEST-KEY')
  const backend=useBackendApiStore();backend.setActiveHost(backend.addHost({url:'https://other-backend.test',nodeName:'pve',token:'OTHER-STAFF-KEY'}))
  await flushPromises()
  expect(view.html()).not.toContain('PRIVATE-TARGET-TEST-KEY')
  expect(view.find('[data-testid="register-environment-target"]').exists()).toBe(false)
  expect(calls.requests.filter(row=>row.body)).toHaveLength(0)
})

it('requires administrator access before offering environment mutations',async()=>{
  calls.role='operator';await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  expect(view.text()).toContain('Administrator access is required')
  expect(view.find('[data-testid="new-native-environment"]').exists()).toBe(false)
  expect(calls.requests.filter(row=>row.path!=='/v1/auth/me')).toHaveLength(0)
})


it('refuses an accidental overwrite of an existing target credential',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-environment-target"]').trigger('click')
  for(const [key,value] of Object.entries({name:'Scoped provisioner', api_url:'https://pve.test:8006', node_name:'pve', token_ref:'workshops@pve!scoped=PRIVATE-TARGET-TEST-KEY'}))await view.get(`[data-testid="environment-target-${key}"]`).setValue(value)
  await view.get('[data-testid="environment-target-form"]').trigger('submit');await flushPromises()
  expect(view.text()).toContain('Choose a new target name')
  expect(calls.requests.filter(row=>row.path==='/v1/proxmox/hosts'&&row.body)).toHaveLength(0)
})

it('ignores an old registration response without clearing credentials entered for a new backend',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-environment-target"]').trigger('click')
  for(const [key,value] of Object.entries({name:'New scoped provisioner', api_url:'https://pve.test:8006', node_name:'pve', token_ref:'workshops@pve!scoped=OLD-TARGET-TEST-KEY'}))await view.get(`[data-testid="environment-target-${key}"]`).setValue(value)
  calls.deferRegister=true
  await view.get('[data-testid="environment-target-form"]').trigger('submit');await flushPromises()
  const backend=useBackendApiStore();backend.setActiveHost(backend.addHost({url:'https://another-backend.test',nodeName:'pve',token:'OTHER-STAFF-KEY'}))
  await flushPromises();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-environment-target"]').trigger('click')
  await view.get('[data-testid="environment-target-token_ref"]').setValue('NEW-TARGET-TEST-KEY')
  calls.releaseRegister?.();await flushPromises()
  expect((view.get('[data-testid="environment-target-token_ref"]').element as HTMLInputElement).value).toBe('NEW-TARGET-TEST-KEY')
  expect(view.text()).not.toContain('Dedicated target registered')
})

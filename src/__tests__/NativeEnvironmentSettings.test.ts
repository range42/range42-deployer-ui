import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Settings from '@/views/Settings.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

const calls = vi.hoisted(() => ({ requests: [] as {path: string; body?: Record<string, unknown>; method?: string}[], role: 'admin', failEnvironmentSave: false, deferRegister: false, releaseRegister: null as null | (() => void) }))
vi.mock('@/services/backendApi', () => ({
  getBackendScope: () => useBackendApiStore().activeHost?.url || '',
  backendRequest: async (path: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined
    calls.requests.push({path, body, method: options?.method || 'GET'})
    if(path==='/v1/proxmox/hosts/scoped/physical-node')return {target_host_id:'scoped',configuration_state:'unavailable',binding:null,needs_review:true}
    if(path==='/v1/proxmox/hosts/scoped/credential/review')return {revision:'b'.repeat(64),host:{id:'scoped',name:'Scoped provisioner',api_url:'https://pve.test:8006',node_name:'pve'}}
    if(path==='/v1/proxmox/hosts/scoped/credential')return {id:'scoped',name:'Scoped provisioner',api_url:'https://pve.test:8006',node_name:'pve',has_token:true}
    if(path==='/v1/auth/me') return {role: calls.role}
    if(path==='/v1/proxmox/hosts' && options?.method==='POST') {
      if(calls.deferRegister) await new Promise<void>(resolve=>{calls.releaseRegister=resolve})
      return {id:'scoped', name:body.name, api_url:body.api_url, node_name:body.node_name, has_token:true}
    }
    if(path==='/v1/proxmox/hosts') return {items:[{id:'scoped', name:'Scoped provisioner', api_url:'https://pve.test:8006', node_name:'pve'}]}
    if(path==='/v1/environments/foundation/review') {
      const count=body.workshop_profile.networks.length
      if(count+14>32)throw new Error(`The gateway uses 14 of 32 NIC slots and needs ${count} additional participant ports. Reduce this environment’s network count or choose another gateway.`)
      return {gateway_foundation:{vmid:body.vmid,node:'pve',name:'Retained gateway',vmgenid:'12345678-1234-1234-1234-123456789abc',owner:'platform:gateway',configuration_revision:'c'.repeat(64),nics:Array.from({length:14},(_,index)=>({interface:`net${index}`,bridge:`vmbr${400+index}`,mac:`02:00:00:00:00:${index.toString(16).padStart(2,'0')}`}))},nic_capacity:{limit:32,occupied:14,additional_required:count,available:18,remaining_after_preparation:18-count},infrastructure_qualified:false}
    }
    if(path==='/v1/environments/infrastructure/review')return {guests:[{vmid:42130,node:'pve',vmgenid:'12345678-1234-1234-1234-123456789abc',owner:'platform:gateway',nics:[{interface:'net1',bridge:'vmbr600',mac:'02:00:00:00:00:02'}]}]}
    if(path==='/v1/environments/review') return {revision:'a'.repeat(64), ready_for_planning:true, infrastructure_qualified:false, workshop_profile:body.workshop_profile, ...(body.reuse_runtime ? {runtime_target:{version:1,physical_node_id:'b'.repeat(32),hardware_binding:'c'.repeat(64),node_name:'pve',installation_id:'d'.repeat(32)}} : {}), requirements:['Live infrastructure preflight is required.']}
    if(path==='/v1/environments' && options?.method==='POST') {if(calls.failEnvironmentSave)throw new Error('The gateway changed after inspection. Inspect it again.');return {id:'env-saved', label:body.label}}
    return {items:[], base_contexts:[{id:'trusted', label:'Trusted native runtime', target_node:'pve', target_api_url:'https://pve.test:8006', ready:true, issues:[]}]}
  },
}))
let view: VueWrapper
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); calls.requests=[]; calls.role='admin';calls.failEnvironmentSave=false;calls.deferRegister=false;calls.releaseRegister=null; useBackendApiStore().addHost({url:'https://backend.test', nodeName:'pve', token:'STAFF-ONLY-TEST-KEY'}) })
afterEach(() => view?.unmount())
async function show() {
  const router=createRouter({history:createMemoryHistory(), routes:[{path:'/:pathMatch(.*)*', component:Settings}]})
  await router.push('/settings?tab=connections')
  view=mount({template:'<RouterView />'}, {global:{plugins:[router]}})
  await flushPromises()
}

it('offers physical-node review for the selected target within environment setup',async()=>{
  await show()
  await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation');await flushPromises()
  expect(view.get('[data-testid="physical-node-identity"]').text()).toContain('Physical server identity')
  expect(calls.requests.some(row=>row.path.endsWith('/physical-node'))).toBe(false)
  await view.get('[data-testid="load-physical-node"]').trigger('click');await flushPromises()
  expect(calls.requests).toContainEqual({path:'/v1/proxmox/hosts/scoped/physical-node',method:'GET',body:undefined})
  expect(view.get('[data-testid="physical-node-identity"]').text()).toContain('not enrolled')
})

it('reviews human provisioning bounds and requires a fresh review after edits', async()=>{
  await show()
  expect(view.find('[data-testid="native-environments"]').exists()).toBe(true)
  expect(calls.requests).toHaveLength(0)
  await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
  for(const [key,value] of Object.entries({label:'Workshop provisioner', base_context_id:'trusted', target_host_id:'scoped', profile_id:'training', vmid_start:'45000', vmid_end:'45039', network_pool:'10.79.0.0/23', network_count:'20', bridge_start:'600', proxmox_template:'9240', deployer_template:'9241', storage:'ceph-range'})) await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  const request=calls.requests.find(row=>row.path==='/v1/environments/review')?.body
  expect(request?.workshop_profile).toMatchObject({vmid_ranges:[[45000,45039]], networks:expect.arrayContaining([{bridge:'vmbr600',subnet:'10.79.0.0/28',gateway:'10.79.0.1'},{bridge:'vmbr619',subnet:'10.79.1.48/28',gateway:'10.79.1.49'}])})
  expect(view.text()).toContain('Live infrastructure preflight')
  const reviewed=view.get('[data-testid="environment-reviewed"]')
  expect(reviewed.text()).toContain('45000–45039')
  expect(reviewed.text()).toContain('Proxmox template 9240')
  expect(reviewed.text()).toContain('Deployer template 9241')
  expect(reviewed.text()).toContain('ceph-range')
  const networks=reviewed.get('[data-testid="environment-reviewed-networks"]')
  expect(networks.findAll('tbody tr')).toHaveLength(20)
  expect(networks.text()).toContain('vmbr600')
  expect(networks.text()).toContain('vmbr619')
  expect(networks.text()).toContain('10.79.1.48/28')
  expect(networks.text()).toContain('10.79.1.49')
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


it('retains gateway inspection only while its preparation bounds remain unchanged',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
  for(const [key,value]of Object.entries({label:'Gateway environment',base_context_id:'trusted',target_host_id:'scoped',profile_id:'gateway-course',vmid_start:'45000',vmid_end:'45039',network_pool:'10.79.0.0/23',network_count:'10',bridge_start:'600',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  await view.get('[data-testid="environment-gateway-vmids"]').setValue('42130')
  await view.get('[data-testid="inspect-environment-infrastructure"]').trigger('click');await flushPromises()
  expect(calls.requests.find(row=>row.path==='/v1/environments/foundation/review')?.body).toMatchObject({vmid:42130,target_host_id:'scoped'})
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  expect(calls.requests.find(row=>row.path==='/v1/environments/review')?.body?.gateway_foundation).toMatchObject({vmid:42130,vmgenid:'12345678-1234-1234-1234-123456789abc',nics:expect.any(Array)})
  await view.get('[data-testid="environment-bridge_start"]').setValue('620')
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  expect(view.text()).toContain('Inspect the selected gateway again')
  expect(view.find('[data-testid="save-native-environment"]').exists()).toBe(false)
})


it('replaces only a reviewed existing target credential without posting host defaults',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="rotate-target-scoped"]').trigger('click');await flushPromises()
  expect(view.get('[data-testid="target-rotation-form"]').text()).toContain('Scoped provisioner')
  expect(view.get('[data-testid="target-rotation-form"]').text()).toContain('https://pve.test:8006')
  await view.get('[data-testid="target-rotation-credential"]').setValue('workshops@pve!renewed=PRIVATE-ROTATED-TEST-KEY')
  await view.get('[data-testid="target-rotation-form"]').trigger('submit');await flushPromises()
  expect(calls.requests.find(row=>row.path==='/v1/proxmox/hosts/scoped/credential')).toEqual({
    path:'/v1/proxmox/hosts/scoped/credential',method:'PUT',body:{expected_revision:'b'.repeat(64),token_ref:'workshops@pve!renewed=PRIVATE-ROTATED-TEST-KEY'},
  })
  expect(calls.requests.some(row=>row.path==='/v1/proxmox/hosts'&&row.method==='POST')).toBe(false)
  expect(view.html()).not.toContain('PRIVATE-ROTATED-TEST-KEY')
  expect(JSON.stringify(localStorage)).not.toContain('PRIVATE-ROTATED-TEST-KEY')
  expect(view.text()).toContain('Credential replaced')
})

it('clears an entered replacement on cancel without submitting it',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="rotate-target-scoped"]').trigger('click');await flushPromises()
  await view.get('[data-testid="target-rotation-credential"]').setValue('workshops@pve!renewed=PRIVATE-CANCELLED-TEST-KEY')
  await view.get('[data-testid="cancel-target-rotation"]').trigger('click')
  expect(view.find('[data-testid="target-rotation-form"]').exists()).toBe(false)
  expect(calls.requests.some(row=>row.path==='/v1/proxmox/hosts/scoped/credential')).toBe(false)
  expect(view.html()).not.toContain('PRIVATE-CANCELLED-TEST-KEY')
})

it('clears replacement authority and credentials when the backend changes',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="rotate-target-scoped"]').trigger('click');await flushPromises()
  await view.get('[data-testid="target-rotation-credential"]').setValue('workshops@pve!renewed=PRIVATE-UNSENT-TEST-KEY')
  const backend=useBackendApiStore();backend.setActiveHost(backend.addHost({url:'https://other.test',nodeName:'pve',token:'OTHER-STAFF-KEY'}));await flushPromises()
  expect(view.find('[data-testid="target-rotation-form"]').exists()).toBe(false)
  expect(calls.requests.some(row=>row.path==='/v1/proxmox/hosts/scoped/credential')).toBe(false)
  expect(view.html()).not.toContain('PRIVATE-UNSENT-TEST-KEY')
})


it('lets a malformed replacement be corrected without discarding the unchanged review',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="rotate-target-scoped"]').trigger('click');await flushPromises()
  await view.get('[data-testid="target-rotation-credential"]').setValue('mistyped')
  await view.get('[data-testid="target-rotation-form"]').trigger('submit');await flushPromises()
  expect(view.get('[data-testid="submit-target-rotation"]').attributes('disabled')).toBeUndefined()
  expect(calls.requests.some(row=>row.path==='/v1/proxmox/hosts/scoped/credential')).toBe(false)
  await view.get('[data-testid="target-rotation-credential"]').setValue('workshops@pve!renewed=PRIVATE-CORRECTED-TEST-KEY')
  await view.get('[data-testid="target-rotation-form"]').trigger('submit');await flushPromises()
  expect(view.text()).toContain('Credential replaced')
})


it('reviews a retained gateway before its new participant ports exist',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
  for(const [key,value]of Object.entries({label:'Future gateway environment',base_context_id:'trusted',target_host_id:'scoped',profile_id:'future-course',vmid_start:'45000',vmid_end:'45039',network_pool:'10.79.0.0/24',network_count:'10',bridge_start:'600',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  await view.get('[data-testid="environment-gateway-vmids"]').setValue('42130')
  await view.get('[data-testid="inspect-environment-infrastructure"]').trigger('click');await flushPromises()
  expect(calls.requests.find(row=>row.path==='/v1/environments/foundation/review')?.body).toMatchObject({vmid:42130,target_host_id:'scoped'})
  const reviewed=view.get('[data-testid="gateway-foundation-review"]')
  expect(reviewed.text()).toContain('14 in use')
  expect(reviewed.text()).toContain('10 additional')
  expect(reviewed.text()).toContain('8 remain')
  expect(reviewed.findAll('tbody tr')).toHaveLength(14)
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  const body=calls.requests.find(row=>row.path==='/v1/environments/review')?.body
  expect(body?.gateway_foundation).toMatchObject({vmid:42130,configuration_revision:'c'.repeat(64),nics:expect.any(Array)})
  expect((body?.workshop_profile as {infrastructure_guests?:unknown}).infrastructure_guests).toBeUndefined()
})

it('shows the actual NIC limit and requires reinspection after reducing the network count',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
  for(const [key,value]of Object.entries({label:'Port capacity review',base_context_id:'trusted',target_host_id:'scoped',profile_id:'future-course',vmid_start:'45000',vmid_end:'45039',network_pool:'10.79.0.0/23',network_count:'20',bridge_start:'600',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  await view.get('[data-testid="environment-gateway-vmids"]').setValue('42130')
  await view.get('[data-testid="inspect-environment-infrastructure"]').trigger('click');await flushPromises()
  expect(view.text()).toContain('14 of 32 NIC slots')
  expect(view.find('[data-testid="gateway-foundation-review"]').exists()).toBe(false)
  await view.get('[data-testid="environment-network_count"]').setValue('10')
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  expect(view.text()).toContain('Inspect the selected gateway again')
  expect(calls.requests.filter(row=>row.path==='/v1/environments/review')).toHaveLength(0)
})


it('clears a failed save review and reloads registered environments before retry',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
  for(const [key,value]of Object.entries({label:'Failed gateway save',base_context_id:'trusted',target_host_id:'scoped',profile_id:'retry-course',vmid_start:'45000',vmid_end:'45039',network_pool:'10.79.0.0/24',network_count:'10',bridge_start:'600',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  await view.get('[data-testid="environment-gateway-vmids"]').setValue('42130')
  await view.get('[data-testid="inspect-environment-infrastructure"]').trigger('click');await flushPromises()
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  expect(view.find('[data-testid="save-native-environment"]').exists()).toBe(true)
  calls.failEnvironmentSave=true
  await view.get('[data-testid="save-native-environment"]').trigger('click');await flushPromises()
  expect(view.find('[data-testid="save-native-environment"]').exists()).toBe(false)
  expect(view.find('[data-testid="gateway-foundation-review"]').exists()).toBe(false)
  expect(view.text()).toContain('gateway changed after inspection')
  expect(calls.requests.filter(row=>row.path==='/v1/environments'&&row.method==='GET')).toHaveLength(2)
})

it('reviews and saves an explicitly selected per-run gateway capability in existing environment settings',async()=>{
  await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
  await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
  for(const [key,value]of Object.entries({label:'Isolated per-run gateways',base_context_id:'trusted',target_host_id:'scoped',profile_id:'per-run-gateway',vmid_start:'45000',vmid_end:'45039',network_pool:'10.78.0.0/24',network_count:'16',bridge_start:'600',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
  const enable=view.get('[data-testid="environment-managed-gateway"]')
  expect((enable.element as HTMLInputElement).checked).toBe(false)
  await enable.setValue(true)
  await view.get('[data-testid="environment-gateway-management-bridge"]').setValue('vmbr550')
  await view.get('[data-testid="environment-gateway-management-subnet"]').setValue('10.78.255.0/29')
  await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
  const request=calls.requests.find(row=>row.path==='/v1/environments/review')?.body
  expect(request?.workshop_profile).toMatchObject({managed_gateway:{management_bridge:'vmbr550',management_subnet:'10.78.255.0/29'}})
  expect(view.get('[data-testid="environment-reviewed"]').text()).toContain('One gateway per run')
  expect(view.get('[data-testid="environment-reviewed"]').text()).toContain('10.78.255.0/29')
  await view.get('[data-testid="save-native-environment"]').trigger('click');await flushPromises()
  expect(calls.requests.find(row=>row.path==='/v1/environments'&&row.method==='POST')?.body?.workshop_profile).toMatchObject({managed_gateway:{management_bridge:'vmbr550',management_subnet:'10.78.255.0/29'}})
})


it('requires an explicit runtime reuse option and shows the server-observed physical target',async()=>{
 await show();await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
 await view.get('[data-testid="new-native-environment"]').trigger('click');await view.get('[data-testid="environment-profile-type"]').setValue('installation')
 expect((view.get('[data-testid="environment-reuse-runtime"]').element as HTMLInputElement).checked).toBe(false)
 for(const[key,value]of Object.entries({label:'Reviewed runtime reuse',profile_id:'runtime-reuse',vmid_start:'45000',vmid_end:'45039',network_pool:'10.79.0.0/24',network_count:'10',bridge_start:'600',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
 await view.get('[data-testid="environment-reuse-runtime"]').setValue(true)
 await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
 expect(calls.requests.filter(row=>row.path==='/v1/environments/review').at(-1)?.body).toMatchObject({reuse_runtime:true})
 expect(view.get('[data-testid="environment-reviewed-runtime-target"]').text()).toContain('pve')
 expect(view.get('[data-testid="environment-reviewed-runtime-target"]').text()).toContain('b'.repeat(32))
 await view.get('[data-testid="environment-reuse-runtime"]').setValue(false)
 expect(view.find('[data-testid="save-native-environment"]').exists()).toBe(false)
 await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
 expect(calls.requests.filter(row=>row.path==='/v1/environments/review').at(-1)?.body).not.toHaveProperty('reuse_runtime')
 expect(view.find('[data-testid="environment-reviewed-runtime-target"]').exists()).toBe(false)
})

import {afterEach,expect,it,vi} from 'vitest'
import {enableAutoUnmount,flushPromises,mount} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {createI18n} from 'vue-i18n'
import NativeDeploymentFields from '@/components/project/NativeDeploymentFields.vue'
import {nativePreviewFromFiles} from '@/services/nativeScenarioCanvas'
import deployment from '@/locales/en/deployment.json'

enableAutoUnmount(afterEach)
const calls=vi.hoisted(()=>({requests:[] as {url:string;body:Record<string,unknown>}[]}))
vi.mock('@/services/backendApi',()=>({getBackendScope:()=> 'generic-fixture',backendRequest:async(url:string,options?:RequestInit)=>{
  if(url==='/v1/contexts')return {items:[{id:'env-'+'c'.repeat(24),label:'Monitoring',target_host_id:'h',ready:true,issues:[],purpose:'native',execution_ready:false,
    provisioning_profile:{version:1,id:'monitoring',vmid_ranges:[[46000,46015]],storage:'ceph-range',networks:[],templates:{
      sensor:{vm_id:9250,memory_mib:2048,cores:1,disks_gib:[24]},collector:{vm_id:9251,memory_mib:8192,cores:3,disks_gib:[48,96]},dashboard:{vm_id:9252,memory_mib:1024,cores:1,disks_gib:[16]}}}}]}
  if(url.includes('/foundation/')){
    const body=JSON.parse(String(options?.body));calls.requests.push({url,body})
    if(url.endsWith('/reservations'))return {project_key:body.project_key,host_id:'h',node_name:'node-b',reservation_id:'monitoring-lease',expires_at:new Date(Date.now()+3600000).toISOString(),assignments:[],limitations:[]}
    return {topology:{vms:[{vm_id:9250},{vm_id:9251},{vm_id:9252}],templates:[],networks:[],warnings:[],reservations:{status:'missing',issues:[]}}}
  }
  return {features:[],topology:{vms:[],templates:[],networks:[],warnings:[],reservations:{status:'missing',issues:[]}},preparation:{version:1,kind:'native-template-preparation',title:'Monitoring templates'}}
}}))

it('opens a generic template preparation descriptor from saved catalog files',()=>{
  const path='scenarios/monitoring'
  const files={[`${path}/main.yml`]:'- hosts: localhost\n  tasks: []\n',[`${path}/manifest/scenario_vms.json`]:JSON.stringify({vms:[]}),
    [`${path}/manifest/preparation.json`]:JSON.stringify({version:1,kind:'native-template-preparation',title:'Monitoring templates'})}
  expect(nativePreviewFromFiles(files,path).preparation?.kind).toBe('native-template-preparation')
})

it('reviews three monitoring sources in the ordinary deploy form without workshop inputs',async()=>{
  calls.requests=[];localStorage.clear()
  const view=mount(NativeDeploymentFields,{props:{projectId:'p',revision:'a'.repeat(40),path:'scenarios/monitoring'},global:{plugins:[createPinia(),createI18n({legacy:false,locale:'en',messages:{en:{deployment}}})]}})
  await flushPromises()
  expect(view.find('[data-testid="foundation-setup"]').exists()).toBe(true)
  expect(view.find('[data-testid="independent-workshop-setup"]').exists()).toBe(false)
  expect(view.text()).toContain('9250')
  expect(view.text()).not.toContain('20 GiB')
  for(const [key,value] of Object.entries({namespace:'monitor-base',source_node:'node-a','source-collector':9201,'source-dashboard':9202,'source-sensor':9200}))
    await view.get(`[data-testid="foundation-input-${key}"]`).setValue(value)
  await view.get('[data-testid="foundation-review-plan"]').trigger('click');await flushPromises()
  expect(calls.requests).toHaveLength(2)
  expect(calls.requests[0]?.body.foundation).toEqual({namespace:'monitor-base',source_node:'node-a',sources:{collector:9201,dashboard:9202,sensor:9200}})
  const selection=view.emitted('select')?.at(-1)?.[0]
  expect(selection).toMatchObject({foundation:{sources:{sensor:9200,collector:9201,dashboard:9202}},allocation:{reservation:{reservation_id:'monitoring-lease'}}})
  expect(selection).not.toHaveProperty('workshop')
  await view.get('[data-testid="foundation-input-source-sensor"]').setValue(9250)
  expect(view.emitted('select')?.at(-1)).toEqual([null])
  expect((view.get('[data-testid="foundation-review-plan"]').element as HTMLButtonElement).disabled).toBe(true)
})

it('includes the selected environment bridge capability in the server preview',async()=>{
 const {default:FoundationSetup}=await import('@/components/project/FoundationSetup.vue')
 calls.requests=[]
 const view=mount(FoundationSetup,{props:{projectId:'p',revision:'a'.repeat(40),path:'scenarios/monitoring',contextId:'env-'+'c'.repeat(24),targetHostId:'h',kind:'native-template-preparation',
   profile:{version:1,id:'monitoring',vmid_ranges:[[46000,46015]],storage:'ceph-range',networks:[],templates:{sensor:{vm_id:9250,memory_mib:2048,cores:1,disks_gib:[24]}},managed_gateway:{management_bridge:'vmbr560',management_subnet:'10.80.255.0/29'}}},global:{plugins:[createPinia()]}})
 for(const[key,value]of Object.entries({namespace:'monitor-base',source_node:'node-a','source-sensor':9200}))await view.get(`[data-testid="foundation-input-${key}"]`).setValue(value)
 await view.get('[data-testid="foundation-prepare-networks"]').setValue(true)
 await view.get('[data-testid="foundation-review-plan"]').trigger('click');await flushPromises()
 expect(calls.requests).toHaveLength(2)
 expect(calls.requests.every(call=>call.body.prepare_environment_networks===true)).toBe(true)
})

it('accepts an explicitly reviewed standard Proxmox source ID without changing destination bounds',async()=>{
 const {default:FoundationSetup}=await import('@/components/project/FoundationSetup.vue')
 calls.requests=[]
 const view=mount(FoundationSetup,{props:{projectId:'p',revision:'a'.repeat(40),path:'scenarios/monitoring',contextId:'env-'+'c'.repeat(24),targetHostId:'h',kind:'native-template-preparation',
  profile:{version:1,id:'monitoring',vmid_ranges:[[46000,46015]],storage:'ceph-range',networks:[],templates:{sensor:{vm_id:9250,memory_mib:2048,cores:1,disks_gib:[24]}}}},global:{plugins:[createPinia()]}})
 for(const[key,value]of Object.entries({namespace:'monitor-base',source_node:'node-a','source-sensor':100}))await view.get(`[data-testid="foundation-input-${key}"]`).setValue(value)
 expect((view.get('[data-testid="foundation-review-plan"]').element as HTMLButtonElement).disabled).toBe(false)
 await view.get('[data-testid="foundation-review-plan"]').trigger('click');await flushPromises()
 expect(calls.requests[0]?.body.foundation).toMatchObject({sources:{sensor:100}})
})

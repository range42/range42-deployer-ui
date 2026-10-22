import {afterEach,expect,it,vi} from 'vitest'
import {enableAutoUnmount,flushPromises,mount} from '@vue/test-utils'
import {createPinia} from 'pinia'
import NativeEnvironmentsPanel from '@/components/settings/NativeEnvironmentsPanel.vue'
enableAutoUnmount(afterEach)
const calls=vi.hoisted(()=>({requests:[] as {url:string;body:Record<string,unknown>}[]}))
vi.mock('@/services/backendApi',()=>({getBackendScope:()=> 'generic-settings',backendRequest:async(url:string,options?:RequestInit)=>{
 const body=options?.body?JSON.parse(String(options.body)):undefined
 if(url==='/v1/auth/me')return {role:'admin'}
 if(url==='/v1/proxmox/hosts')return {items:[{id:'h',name:'Monitoring target',node_name:'node-b',api_url:'https://pve.example.test:8006'}]}
 if(url==='/v1/environments/review'){calls.requests.push({url,body});return {revision:'a'.repeat(64),provisioning_profile:body.provisioning_profile,requirements:['Live preflight required'],infrastructure_qualified:false}}
 if(url==='/v1/environments'&&options?.method==='POST'){calls.requests.push({url,body});return {id:'env-saved'}}
 return {items:[],base_contexts:[{id:'base',label:'Native runtime',target_node:'node-b',target_api_url:'https://pve.example.test:8006',ready:true,issues:[]}]}
}}))
it('registers a custom template set through Settings and invalidates review after a hardware edit',async()=>{
 calls.requests=[]
 const view=mount(NativeEnvironmentsPanel,{global:{plugins:[createPinia()]}})
 await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
 await view.get('[data-testid="new-native-environment"]').trigger('click')
 await view.get('[data-testid="environment-profile-type"]').setValue('custom')
 for(const[key,value]of Object.entries({label:'Monitoring',base_context_id:'base',target_host_id:'h',profile_id:'monitoring',vmid_start:46000,vmid_end:46015,network_count:1,network_pool:'10.80.0.0/28',bridge_start:650,storage:'ceph-range'}))
   await view.get(`[data-testid="environment-${key}"]`).setValue(value)
 for(const[key,value]of Object.entries({role:'sensor',vm_id:9250,memory_mib:2048,cores:1,disks_gib:'24'}))
   await view.get(`[data-testid="template-0-${key}"]`).setValue(value)
 await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
 expect(calls.requests[0]?.body).toMatchObject({provisioning_profile:{templates:{sensor:{vm_id:9250,memory_mib:2048,cores:1,disks_gib:[24]}}}})
 expect(calls.requests[0]?.body).not.toHaveProperty('workshop_profile')
 expect(view.get('[data-testid="save-native-environment"]').exists()).toBe(true)
 await view.get('[data-testid="template-0-memory_mib"]').setValue(4096)
 expect(view.find('[data-testid="save-native-environment"]').exists()).toBe(false)
 await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
 await view.get('[data-testid="save-native-environment"]').trigger('click');await flushPromises()
 expect(calls.requests.at(-1)?.body).toMatchObject({review_revision:'a'.repeat(64),provisioning_profile:{templates:{sensor:{memory_mib:4096}}}})
})

it('defaults to a general profile and permits template preparation without network enrollment',async()=>{
 calls.requests=[]
 const view=mount(NativeEnvironmentsPanel,{global:{plugins:[createPinia()]}})
 await view.get('[data-testid="load-native-environments"]').trigger('click');await flushPromises()
 await view.get('[data-testid="new-native-environment"]').trigger('click')
 expect((view.get('[data-testid="environment-profile-type"]').element as HTMLSelectElement).value).toBe('custom')
 for(const[key,value]of Object.entries({label:'Offline sensor',base_context_id:'base',target_host_id:'h',profile_id:'sensor-only',vmid_start:46000,vmid_end:46015,storage:'ceph-range'}))await view.get(`[data-testid="environment-${key}"]`).setValue(value)
 for(const[key,value]of Object.entries({role:'sensor',vm_id:9250,memory_mib:2048,cores:1,disks_gib:'24'}))await view.get(`[data-testid="template-0-${key}"]`).setValue(value)
 await view.get('[data-testid="native-environment-form"]').trigger('submit');await flushPromises()
 expect(calls.requests[0]?.body).toMatchObject({provisioning_profile:{networks:[],templates:{sensor:{vm_id:9250}}}})
 expect(calls.requests[0]?.body).not.toHaveProperty('gateway_foundation')
})

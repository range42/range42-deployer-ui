import {afterEach, expect, it, vi} from 'vitest'
import {enableAutoUnmount, flushPromises, mount} from '@vue/test-utils'
import {createPinia} from 'pinia'
import NativeScenarioPreview from '@/components/catalog/NativeScenarioPreview.vue'
import WorkshopRunSetup from '@/components/project/WorkshopRunSetup.vue'
import {nativeScenarioCanvas, type NativeTopology} from '@/services/nativeScenarioCanvas'

enableAutoUnmount(afterEach)
const calls = vi.hoisted(() => ({preview:vi.fn(), reservation:vi.fn()}))
vi.mock('@/services/backendApi', () => ({getBackendScope:()=> 'fixture', backendRequest: async(url:string, options?:RequestInit)=>{
 const body=JSON.parse(String(options?.body))
 if(url.endsWith('/native-scenario/preview')){
  calls.preview(body)
  return {topology:topology(), allocation_request:{vmid_start:45000,vmid_end:45010,networks:[
   {network_id:'vmbr600',bridge:'vmbr600',subnet:'10.78.0.0/28',gateway:'10.78.0.1',gateway_node_id:'managed-gateway'},
   {network_id:'vmbr550',bridge:'vmbr550',subnet:'10.78.255.0/29',gateway:'10.78.255.1'}],vms:[
   {node_id:'user01-proxmox',vm_id:45000,nics:[{index:0,network_id:'vmbr600',ip:'10.78.0.2'}]},
   {node_id:'managed-gateway',vm_id:45010,nics:[{index:0,network_id:'vmbr550',ip:body.workshop.managed_gateway.management_ip},{index:1,network_id:'vmbr600',ip:'10.78.0.1'}]}]}}
 }
 calls.reservation(body)
 return {project_key:body.project_key,host_id:'host',reservation_id:'gateway-lease',expires_at:new Date(Date.now()+3600000).toISOString(),assignments:[]}
}}))
function profile(managed=true){return {id:'approved-gateway-workshop',vmid_ranges:[[45000,45039]],proxmox_template:9240,deployer_template:9241,storage:'ceph-range',
 networks:Array.from({length:16},(_,i)=>({bridge:`vmbr${600+i}`,subnet:`10.78.0.${i*16}/28`})),
 ...(managed?{managed_gateway:{management_bridge:'vmbr550',management_subnet:'10.78.255.0/29'}}:{})}}
const props={projectId:'project',revision:'a'.repeat(40),path:'scenarios/workshop',targetHostId:'host',minSeats:1,maxSeats:10}
function topology():NativeTopology{return {vms:[
 {vm_id:45000,vm_name:'training-user01-pve',bridge:'vmbr600',ip:'10.78.0.2'},
 {vm_id:45010,vm_name:'training-gateway',bridge:'vmbr550',ip:'10.78.255.2',role:'gateway',nics:[
  {index:0,bridge:'vmbr550',ip:'10.78.255.2',prefix:29},
  {index:1,bridge:'vmbr600',ip:'10.78.0.1',prefix:28}]}],
 networks:[{vnet:'vmbr600',subnet:'10.78.0.0/28',gateway:'10.78.0.1'},{vnet:'vmbr550',subnet:'10.78.255.0/29',gateway:'10.78.255.1'}],templates:[],warnings:[],reservations:{status:'checked',issues:[]}}}

it('offers gateway resources only for an explicitly enrolled profile and invalidates review when it changes',async()=>{
 const view=mount(WorkshopRunSetup,{props:{...props,profile:profile(false)},global:{plugins:[createPinia()]}})
 expect(view.find('[data-testid="workshop-managed-gateway"]').exists()).toBe(false)
 await view.setProps({profile:profile()})
 expect(view.get('[data-testid="workshop-managed-gateway"]').text()).toContain('vmbr550')
 expect((view.get('[data-testid="workshop-input-gateway_vm_id"]').element as HTMLInputElement).value).toBe('45010')
 expect((view.get('[data-testid="workshop-input-gateway_management_ip"]').element as HTMLSelectElement).value).toBe('10.78.255.2')
 await view.get('[data-testid="workshop-input-namespace"]').setValue('training')
 await view.get('[data-testid="workshop-input-expires_at"]').setValue('2030-10-23T18:00')
 await view.get('[data-testid="workshop-input-participants_per_environment"]').setValue('2')
 await view.get('[data-testid="workshop-review-plan"]').trigger('click');await flushPromises()
 expect(calls.preview).toHaveBeenLastCalledWith(expect.objectContaining({workshop:expect.objectContaining({managed_gateway:{vm_id:45010,management_bridge:'vmbr550',management_subnet:'10.78.255.0/29',management_ip:'10.78.255.2'}})}))
 expect(calls.reservation.mock.calls.at(-1)?.[0].networks[0]).toMatchObject({gateway_node_id:'managed-gateway'})
 expect(view.emitted('select')?.at(-1)?.[0]).toMatchObject({allocation:{reservation:{reservation_id:'gateway-lease'}}})
 expect(view.get('[data-testid="workshop-group-summary"]').text()).toContain('4 GiB gateway')
 await view.get('[data-testid="workshop-input-gateway_management_ip"]').setValue('10.78.255.3')
 expect(view.emitted('select')?.at(-1)).toEqual([null])
 await view.setProps({profile:profile(false)})
 expect(view.find('[data-testid="workshop-managed-gateway"]').exists()).toBe(false)
 expect(view.emitted('select')?.at(-1)).toEqual([null])
})

it('shows every gateway NIC in the native diagram and retains participant links',()=>{
 const graph=nativeScenarioCanvas('workshop','Training','scenarios/workshop',topology())
 const gateway=graph.nodes.find(node=>node.data.config?.vmid===45010)!
 expect(gateway).toBeTruthy()
 const links=graph.edges.filter(edge=>edge.source===gateway.id)
 expect(links).toHaveLength(2)
 expect(links.map(edge=>graph.nodes.find(node=>node.id===edge.target)?.data.config.bridge).sort()).toEqual(['vmbr550','vmbr600'])
 expect(links.map(edge=>(edge.data as {connection:{interfaceName:string}}).connection.interfaceName).sort()).toEqual(['net0','net1'])
 expect(graph.edges.filter(edge=>edge.source!==gateway.id)).toHaveLength(1)
})

it('rejects ambiguous multi-interface declarations before rendering a misleading gateway diagram',()=>{
 for(const nics of [
  [{index:0,bridge:'vmbr550'},{index:0,bridge:'vmbr600'}],
  [{index:1,bridge:'vmbr550'}],
  [{index:0,bridge:'../../outside'}],
 ]){
  const invalid=topology();invalid.vms[1]!.nics=nics
  expect(()=>nativeScenarioCanvas('workshop','Training','scenarios/workshop',invalid)).toThrow('interface identities')
 }
})


it('makes each gateway connection readable in the normal native deployment preview',()=>{
 const view=mount(NativeScenarioPreview,{props:{topology:topology()}})
 const interfaces=view.findAll('[data-testid="native-gateway-interface"]')
 expect(interfaces).toHaveLength(2)
 expect(interfaces.map(nic=>nic.text())).toEqual(expect.arrayContaining([
  expect.stringContaining('net0 · vmbr550 · 10.78.255.2/29'),
  expect.stringContaining('net1 · vmbr600 · 10.78.0.1/28'),
 ]))
 expect(view.get('[data-testid="native-network-vmbr600"]').text()).toContain('training-gateway · net1')
 expect(view.get('[data-testid="native-resource-summary"]').text()).toContain('2 VMs · 2 networks')
})

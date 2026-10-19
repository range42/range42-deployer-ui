import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import NativeDeploymentFields from '@/components/project/NativeDeploymentFields.vue'
import NativeScenarioPreview from '@/components/catalog/NativeScenarioPreview.vue'
import deployment from '@/locales/en/deployment.json'
enableAutoUnmount(afterEach)
const topology = { vms: Array.from({ length: 20 }, (_, i) => ({ vm_id: 43010+i, seat: Math.floor(i/2)+1, vm_name: `seat-${Math.floor(i/2)+1}-${i%2}`, bridge: `vmbr${430+Math.floor(i/2)}`, cores: 2, memory_mib: 4096, disk_gib: 32, ...(i>=10?{requires_features:['EXTRA_SEATS']}: {}) })), templates: [], networks: Array.from({length:10},(_,i)=>({vnet:`vmbr${430+i}`})), warnings: [], reservations: {status:'checked' as const, issues:[]} }
vi.mock('@/services/backendApi', () => ({ getBackendScope: () => 'fixture', backendRequest: async (url: string) => url === '/v1/contexts'
  ? { items: [{ id:'pve',target_host_id:'host',ready:true,issues:[] }] }
  : { features:[{id:'EXTRA_SEATS',default:false}], topology } }))
const open=async()=>{const view=mount(NativeDeploymentFields,{props:{projectId:'project',revision:'a'.repeat(40),path:'scenarios/range42-native-workshop'},global:{plugins:[createPinia(),createI18n({legacy:false,locale:'en',messages:{en:{deployment}}})]}});await flushPromises();return view}
it('requires visible workshop qualification choices and emits the matching native parameters',async()=>{
 const view=await open()
 expect(view.emitted('select')?.at(-1)).toEqual([null])
 for(const id of ['NETWORK','TEMPLATE','ALLOCATION'])await view.get(`[data-testid="workshop-accept-${id}"]`).setValue(true)
 expect(view.emitted('select')?.at(-1)?.[0]).toMatchObject({parameters:{WORKSHOP_NETWORK_ACCEPTED:true,WORKSHOP_TEMPLATE_ACCEPTED:true,WORKSHOP_ALLOCATION_ACCEPTED:true,WORKSHOP_ONLY_SEAT:0}})
 await view.get('[data-testid="workshop-seat"]').setValue('1')
 expect(view.get('[data-testid="native-resource-summary"]').text()).toContain('2 VMs')
})
it('keeps an incompatible selected seat blocked when the ten-seat feature is turned off',async()=>{
 const view=await open()
 for(const id of ['NETWORK','TEMPLATE','ALLOCATION'])await view.get(`[data-testid="workshop-accept-${id}"]`).setValue(true)
 await view.get('[data-testid="native-feature-EXTRA_SEATS"]').setValue(true)
 await view.get('[data-testid="workshop-seat"]').setValue('6')
 await view.get('[data-testid="native-feature-EXTRA_SEATS"]').setValue(false)
 expect(view.emitted('select')?.at(-1)).toEqual([null])
 expect(view.get('[data-testid="workshop-seat"]').element.value).toBe('6')
 expect(view.text()).toContain('Enable ten participants')
})
it('keeps deployment totals visible while a compact topology is collapsed',async()=>{
 const view=mount(NativeScenarioPreview,{props:{topology,compact:true,selectedFeatures:{EXTRA_SEATS:true},selectedSeat:1}})
 expect(view.get('[data-testid="native-resource-summary"]').text()).toContain('2 VMs')
 expect(view.get('[data-testid="native-topology-details"]').attributes('open')).toBeUndefined()
})

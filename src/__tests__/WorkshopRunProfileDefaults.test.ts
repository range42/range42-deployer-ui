import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import WorkshopRunSetup from '@/components/project/WorkshopRunSetup.vue'

function profile() {
  return {id:'reviewed-training',vmid_ranges:[[45000,45039]],proxmox_template:9240,deployer_template:9241,storage:'ceph-range',
    networks:Array.from({length:20},(_,index)=>({bridge:`vmbr${600+index}`,subnet:`10.79.${Math.floor(index/16)}.${16*(index%16)}/28`,gateway:`10.79.${Math.floor(index/16)}.${16*(index%16)+1}`}))}
}
const props={projectId:'p',revision:'a'.repeat(40),path:'scenarios/installation',targetHostId:'scoped',minSeats:1,maxSeats:10}

it('fills deployment resources from the selected reviewed profile and keeps human run details on a change',async()=>{
  const view=mount(WorkshopRunSetup,{props:{...props,profile:profile()},global:{plugins:[createPinia()]}})
  for(const [key,value]of Object.entries({seats:'5',vmid_start:'45000',proxmox_template:'9240',deployer_template:'9241',storage:'ceph-range',bridge_start:'600',network_pool:'10.79.0.0/24'}))expect((view.get(`[data-testid="workshop-input-${key}"]`).element as HTMLInputElement).value).toBe(value)
  await view.get('[data-testid="workshop-input-namespace"]').setValue('friday-training')
  await view.get('[data-testid="workshop-input-expires_at"]').setValue('2030-10-23T18:00')
  await view.setProps({profile:{...profile(),id:'new-version',proxmox_template:9250}})
  expect((view.get('[data-testid="workshop-input-proxmox_template"]').element as HTMLInputElement).value).toBe('9250')
  expect((view.get('[data-testid="workshop-input-namespace"]').element as HTMLInputElement).value).toBe('friday-training')
  expect((view.get('[data-testid="workshop-input-expires_at"]').element as HTMLInputElement).value).toBe('2030-10-23T18:00')
  expect(view.text()).toContain('new-version')
  view.unmount()
})

it('uses only consecutive approved bridge/subnet pairs when suggesting participant resources',()=>{
  const value=profile();value.networks=value.networks.slice(0,3);value.networks[2]!.subnet='10.79.0.48/28'
  const view=mount(WorkshopRunSetup,{props:{...props,profile:value},global:{plugins:[createPinia()]}})
  expect((view.get('[data-testid="workshop-input-seats"]').element as HTMLInputElement).value).toBe('2')
  expect((view.get('[data-testid="workshop-input-network_pool"]').element as HTMLInputElement).value).toBe('10.79.0.0/27')
  view.unmount()
})

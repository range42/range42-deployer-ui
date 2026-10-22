import {expect,it} from 'vitest'
import {installationProfile,type ResourceProfile} from '@/services/provisioning'
it('adapts an approved general template set for the installation recipe without changing it',()=>{
 const profile:ResourceProfile={version:1,id:'general',vmid_ranges:[[45000,45039]],networks:[{bridge:'vmbr600',subnet:'10.78.0.0/28',gateway:'10.78.0.1'}],storage:'ceph-range',templates:{
  proxmox:{vm_id:9240,memory_mib:16384,cores:4,disks_gib:[32,128]},deployer:{vm_id:9241,memory_mib:4096,cores:2,disks_gib:[32]}}}
 const before=JSON.stringify(profile)
 expect(installationProfile(profile)).toMatchObject({id:'general',proxmox_template:9240,deployer_template:9241})
 expect(JSON.stringify(profile)).toBe(before)
 profile.templates.proxmox!.memory_mib=8192
 expect(installationProfile(profile)).toBeNull()
})

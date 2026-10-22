/** Shared native resource capabilities; recipes choose which ones to consume. */
export interface TemplateCapability {vm_id: number; memory_mib: number; cores: number; disks_gib: number[]}
export interface ResourceProfile {
  version: 1; id: string; vmid_ranges: number[][]; storage: string;
  templates: Record<string, TemplateCapability>;
  networks: {bridge: string; subnet: string; gateway: string}[];
  managed_gateway?: {management_bridge: string; management_subnet: string} | null;
}
export interface LegacyTemplateProfile {proxmox_template?: number; deployer_template?: number; storage?: string;
  managed_gateway?: {management_bridge: string; management_subnet: string} | null}
export type PreparationProfile = ResourceProfile | LegacyTemplateProfile
export function templatesFor(profile?: PreparationProfile | null): Record<string,TemplateCapability> {
  if (!profile) return {}
  if ('templates' in profile) return profile.templates
  if (!profile.proxmox_template || !profile.deployer_template) return {}
  return {proxmox: {vm_id:profile.proxmox_template,memory_mib:16384,cores:4,disks_gib:[32,128]},
    deployer: {vm_id:profile.deployer_template,memory_mib:4096,cores:2,disks_gib:[32]}}
}

/** The installation recipe consumes general bounds without changing registration. */
export function installationProfile(profile?: PreparationProfile | null): {
 id:string;vmid_ranges?:number[][];networks?:{bridge:string;subnet:string}[];
 proxmox_template?:number;deployer_template?:number;storage?:string;
 managed_gateway?:{management_bridge:string;management_subnet:string}|null
} | null {
 if(!profile)return null
 if(!('templates' in profile))return {...profile,id:'id' in profile ? String(profile.id) : ''}
 const proxmox=profile.templates.proxmox,deployer=profile.templates.deployer
 if(!profile.networks.length||!proxmox||!deployer||proxmox.memory_mib!==16384||proxmox.cores!==4
  ||JSON.stringify(proxmox.disks_gib)!=='[32,128]'||deployer.memory_mib!==4096||deployer.cores!==2||JSON.stringify(deployer.disks_gib)!=='[32]')return null
 return {id:profile.id,vmid_ranges:profile.vmid_ranges,networks:profile.networks,storage:profile.storage,
  proxmox_template:proxmox.vm_id,deployer_template:deployer.vm_id,...(profile.managed_gateway?{managed_gateway:profile.managed_gateway}:{})}
}

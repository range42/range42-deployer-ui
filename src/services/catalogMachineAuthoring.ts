/** Portable clone specifications; template construction remains an upstream workflow. */
import { stringify } from 'yaml'
import type { CatalogEntry, Node } from '@/types/range42-schema'
import type { CatalogRoleDraft } from './catalogRoleAuthoring'

export interface CatalogMachineInput {
  category: string; target: string; description: string; tags: string; os: string
  cores: number | string; memory_mb: number | string; disk_gb: number | string
  template_vmid?: number | string; storage?: string
}

function integer(value: number | string, name: string, minimum: number, maximum: number): number {
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be a whole number between ${minimum} and ${maximum}.`)
  }
  return Number(value)
}

export function buildCatalogMachine(input: CatalogMachineInput, existingPaths: Iterable<string> = []): CatalogRoleDraft {
  const category = input.category.trim(), target = input.target.trim()
  if (![category, target].every(value => /^[a-z][a-z0-9_-]*$/.test(value))) throw new Error('Use lowercase category and target names with letters, numbers, underscores or hyphens.')
  const name = `${category}.clone.${target}`
  if (name.length > 128) throw new Error('The machine name must be at most 128 characters.')
  const path = `05_topology_layer/box_templates/${name}/v1.0.0`
  if ([...existingPaths].some(existing => existing === path || existing.startsWith(`${path}/`))) throw new Error(`The machine ${name} already exists. Choose another name.`)
  const description = input.description.trim(), os = input.os.trim()
  if (!description || !os) throw new Error('A description and required operating system are required.')
  if (description.length > 4096 || os.length > 128) throw new Error('Keep the description under 4096 characters and the operating system under 128 characters.')
  const storage = input.storage?.trim() || ''
  if (storage && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(storage)) throw new Error('Use a literal Proxmox storage name.')
  const vm: Node = { id: target, kind: 'vm', role: 'admin', config: {
    name: target.replace(/_/g, '-'), os,
    cores: integer(input.cores, 'CPU cores', 1, 128),
    memory_mb: integer(input.memory_mb, 'Memory (MiB)', 128, 1048576),
    disk_gb: integer(input.disk_gb, 'Disk (GiB)', 1, 65536),
    ...(storage ? { storage } : {}),
  }, networks: [{ node_ref: 'network', dhcp: true }] }
  if (input.template_vmid !== undefined && input.template_vmid !== '') vm.template_vmid = integer(input.template_vmid, 'Template VMID', 100, 999999999)
  const doc: CatalogEntry = { schema_version: '1.0', kind: 'component', name, description,
    tags: [...new Set(input.tags.split(',').map(tag => tag.trim()).filter(Boolean))],
    nodes: [vm, { id: 'network', kind: 'network' }],
  }
  const readme = `# ${name}\n\n${description}\n\n## Requirements and placement\n\n- Existing cloud-init template running ${os}.\n- ${vm.config!.cores} CPU cores, ${vm.config!.memory_mb} MiB RAM and a disk of at least ${vm.config!.disk_gb} GiB.\n- Choose the registered Proxmox host and local template VMID for your installation.\n- Review clone destination storage in Scenario before deployment. Blank inherits template storage; a selected pool receives the new full clone. This does not move disks of existing guests.\n- SDN is the default: review zone, VNet, subnet, gateway, outgoing NAT and an unused static guest address in Scenario before deployment.\n- The network link is a placeholder until those addresses are assigned.\n- Configure the guest SSH user to match the selected template.\n\nUse Create project or Add to project in the catalog. Each addition gets fresh node names; allocation assigns runtime VMIDs and addresses. Review the generated Ansible files, save to the project branch, then deploy its exact commit. This blueprint does not build a template.\n${vm.template_vmid ? '\nThe suggested template VMID is specific to its original installation. Verify it on the selected host.\n' : ''}${storage ? '\nThe suggested storage name is specific to its original installation. Verify it on the selected host.\n' : ''}`
  return { name, path, files: { [`${path}/range42.yaml`]: stringify(doc), [`${path}/README.md`]: readme } }
}

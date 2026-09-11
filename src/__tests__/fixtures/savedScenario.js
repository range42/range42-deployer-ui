import { emitConcreteScenario } from '@/services/concreteScenario'
import { assetFromBytes } from '@/services/projectFiles'

export function savedScenario() {
  const project = {
    id: 'project_saved', name: 'Saved scenario',
    git: { source_id: 'source', provider: 'github', base_url: 'https://github.com', repo_owner: 'owner',
      repo_name: 'repo', branch: 'main', working_branch: 'range42-ui/original', branch_strategy: 'dedicated_repo' },
    nodes: [{ id: 'vm1', type: 'vm', position: { x: 120, y: 90 }, data: { label: 'Guest', config: { template: '9901' } } },
      { id: 'net1', type: 'network-segment', position: { x: 430, y: 90 }, data: { config: {} } }],
    edges: [{ id: 'nic1', source: 'vm1', target: 'net1', type: 'network', data: { connection: {} } }],
    attachments: [],
    baseDoc: { env: [{ name: 'PORT', default: 8080 }, { name: 'VAULT_VALUE', secret: true, required: true }] },
    overlay: { param_overrides: { env: { PORT: 8443 } } },
    scenario: { label: 'saved', network_mode: 'sdn', zone: 'r42saved',
      networks: [{ id: 'net1', vnet: 'saved1', subnet: '10.42.7.0/24', gateway: '10.42.7.1', snat: true }],
      vms: [{ node_id: 'vm1', vm_id: 3101, vm_name: 'saved-vm', template_vm_id: 9901,
        network_id: 'net1', ip: '10.42.7.10', ssh_user: 'alice', cores: 2, memory_mb: 2048,
        nics: [{ network_id: 'net1', ip: '10.42.7.10' }] }],
      content: [{ id: 'asset', kind: 'file', target_node: 'vm1', path: 'content/logo.bin', destination: '/tmp/logo.bin', mode: '0644' }],
    },
    files: { 'scenarios/saved/content/logo.bin': assetFromBytes(Uint8Array.of(0, 255, 128, 10)), 'notes.txt': '\uFEFFKeep my notes\r\n' },
  }
  const generated = emitConcreteScenario({ ...project, generatedPaths: [] })
  return { ...project, scenario: generated.scenario, files: generated.files, scenario_generated_paths: generated.generatedPaths }
}

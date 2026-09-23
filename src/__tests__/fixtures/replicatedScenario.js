import { createHash } from 'node:crypto'

export const replicationKey = (kind, source, team, user = null) => `${kind}-${createHash('sha256').update(JSON.stringify(['course-1', source, team, user])).digest('hex')}`

export function replicatedScenario() {
  return {
    nodes: [{ id: 'vm1', type: 'vm', data: {} }, { id: 'net1', type: 'network-segment', data: {} }],
    edges: [{ id: 'nic-primary', source: 'vm1', target: 'net1' }],
    scenario: {
      label: 'replicated', network_mode: 'sdn', zone: 'r42repl',
      vms: [{ node_id: 'vm1', vm_name: 'workstation', vm_id: 3100, template_vm_id: 9901, ssh_user: 'alice',
        nics: [{ key: 'nic-primary', network_id: 'net1', ip: '10.42.9.10' }] }],
      networks: [{ id: 'net1', vnet: 'source1', subnet: '10.42.9.0/24', gateway: '10.42.9.1', snat: false }],
      content: [{ id: 'copy', kind: 'file', target_node: 'vm1', path: 'content/example.txt', destination: '/tmp/example.txt' }],
      replication: {
        version: 1, scenario_id: 'course-1',
        teams: [{ id: 'blue', users: [{ id: 'bob' }, { id: 'alice' }] }, { id: 'red', users: [{ id: 'eve' }] }],
        node_scopes: { vm1: 'per_user' }, network_scopes: { net1: 'per_team' },
        vm_assignments: {
          [replicationKey('vm', 'vm1', 'blue', 'alice')]: { vm_id: 3101, nics: { 'nic-primary': { ip: '10.42.10.11' } } },
          [replicationKey('vm', 'vm1', 'blue', 'bob')]: { vm_id: 3102, nics: { 'nic-primary': { ip: '10.42.10.12' } } },
          [replicationKey('vm', 'vm1', 'red', 'eve')]: { vm_id: 3103, nics: { 'nic-primary': { ip: '10.42.11.11' } } },
        },
        network_assignments: {
          [replicationKey('net', 'net1', 'blue')]: { vnet: 'blue1', subnet: '10.42.10.0/24', gateway: '10.42.10.1', snat: false },
          [replicationKey('net', 'net1', 'red')]: { vnet: 'red1', subnet: '10.42.11.0/24', gateway: '10.42.11.1', snat: true },
        },
      },
    },
    files: { 'scenarios/replicated/content/example.txt': 'shared bytes\n' },
  }
}


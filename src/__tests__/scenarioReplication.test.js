import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { expandScenarioReplication, scenarioInstanceKey } from '@/services/scenarioReplication'
import { emitConcreteScenario } from '@/services/concreteScenario'

const key = (kind, source, team, user = null) => `${kind}-${createHash('sha256').update(JSON.stringify(['course-1', source, team, user])).digest('hex')}`

function fixture() {
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
          [key('vm', 'vm1', 'blue', 'alice')]: { vm_id: 3101, nics: { 'nic-primary': { ip: '10.42.10.11' } } },
          [key('vm', 'vm1', 'blue', 'bob')]: { vm_id: 3102, nics: { 'nic-primary': { ip: '10.42.10.12' } } },
          [key('vm', 'vm1', 'red', 'eve')]: { vm_id: 3103, nics: { 'nic-primary': { ip: '10.42.11.11' } } },
        },
        network_assignments: {
          [key('net', 'net1', 'blue')]: { vnet: 'blue1', subnet: '10.42.10.0/24', gateway: '10.42.10.1', snat: false },
          [key('net', 'net1', 'red')]: { vnet: 'red1', subnet: '10.42.11.0/24', gateway: '10.42.11.1', snat: true },
        },
      },
    },
    files: { 'scenarios/replicated/content/example.txt': 'shared bytes\n' },
  }
}

describe('concrete scenario replication', () => {
  it('emits every user and only its own team network as literal VM, NIC and content targets', () => {
    const input = fixture()
    const result = emitConcreteScenario(input)
    const files = result.files
    const vmManifest = JSON.parse(files['scenarios/replicated/manifest/scenario_vms.json'])
    expect(vmManifest.vms).toHaveLength(3)
    expect(vmManifest.vms.map(vm => [vm.vm_id, vm.bridge, vm.ip])).toEqual([
      [3101, 'blue1', '10.42.10.11'], [3102, 'blue1', '10.42.10.12'], [3103, 'red1', '10.42.11.11'],
    ])
    const instances = JSON.parse(files['scenarios/replicated/manifest/scenario_instances.json'])
    expect(instances.instances.map(vm => [vm.instance_key, vm.team_id, vm.user_id, vm.nics[0].network_instance_key])).toEqual([
      [key('vm', 'vm1', 'blue', 'alice'), 'blue', 'alice', key('net', 'net1', 'blue')],
      [key('vm', 'vm1', 'blue', 'bob'), 'blue', 'bob', key('net', 'net1', 'blue')],
      [key('vm', 'vm1', 'red', 'eve'), 'red', 'eve', key('net', 'net1', 'red')],
    ])
    expect(instances.networks).toHaveLength(2)
    const configure = parse(files['scenarios/replicated/configure.yml'])
    expect(configure.map(play => play.hosts)).toEqual(vmManifest.vms.map(vm => vm.vm_name))
    expect(result.scenario.replication).toEqual(input.scenario.replication)
    expect(result.scenario.vms).toHaveLength(1)
  })

  it('keeps one explicitly shared VM and subnet even with a populated roster', () => {
    const input = fixture()
    input.scenario.replication.node_scopes.vm1 = 'shared'
    input.scenario.replication.network_scopes.net1 = 'shared'
    const result = emitConcreteScenario(input)
    const manifest = JSON.parse(result.files['scenarios/replicated/manifest/scenario_instances.json'])
    expect(manifest.instances).toEqual([expect.objectContaining({ vm_id: 3100, hostname: 'workstation', team_id: null, user_id: null })])
    expect(manifest.networks).toHaveLength(1)
  })

  it('expands one VM per team and retains reviewed assignments through roster reorder and growth', () => {
    const input = fixture()
    input.scenario.replication.node_scopes.vm1 = 'per_team'
    for (const [index, team] of ['blue', 'red'].entries()) {
      input.scenario.replication.vm_assignments[key('vm', 'vm1', team)] = { vm_id: 3201 + index, nics: { 'nic-primary': { ip: `10.42.${10 + index}.20` } } }
    }
    const first = expandScenarioReplication(input)
    input.scenario.replication.teams.reverse()
    input.scenario.replication.teams[0].users.reverse()
    expect(expandScenarioReplication(input).manifest).toEqual(first.manifest)
    input.scenario.replication.teams.push({ id: 'green', users: [] })
    input.scenario.replication.vm_assignments[key('vm', 'vm1', 'green')] = { vm_id: 3203, nics: { 'nic-primary': { ip: '10.42.12.20' } } }
    input.scenario.replication.network_assignments[key('net', 'net1', 'green')] = { vnet: 'green1', subnet: '10.42.12.0/24', gateway: '10.42.12.1', snat: false }
    const grown = expandScenarioReplication(input)
    expect(grown.manifest.instances.filter(vm => vm.team_id !== 'green')).toEqual(first.manifest.instances)
    expect(grown.manifest.instances).toHaveLength(3)
    input.scenario.replication.teams = input.scenario.replication.teams.filter(team => team.id !== 'green')
    expect(expandScenarioReplication(input).manifest).toEqual(first.manifest)
  })

  it('rejects unknown source content instead of silently dropping its work', () => {
    const input = fixture()
    input.scenario.content[0].target_node = 'missing'
    expect(() => expandScenarioReplication(input)).toThrow(/content.*target|select.*VM/i)
  })

  it.each(['missing VM', 'extra VM', 'unsupported node', 'unknown scope', 'empty roster', 'empty user roster', 'nested domain', 'scope conflict'])('rejects invalid authoring: %s', reason => {
    const input = fixture()
    if (reason === 'missing VM') input.nodes = input.nodes.filter(node => node.id !== 'vm1')
    if (reason === 'extra VM') input.nodes.push({ id: 'unconfigured', type: 'vm', data: {} })
    if (reason === 'unsupported node') input.nodes.push({ id: 'router', type: 'router', data: {} })
    if (reason === 'unknown scope') input.scenario.replication.node_scopes.vm1 = 'everyone'
    if (reason === 'empty roster') input.scenario.replication.teams = []
    if (reason === 'empty user roster') input.scenario.replication.teams.forEach(team => { team.users = [] })
    if (reason === 'nested domain') {
      input.nodes.push({ id: 'outer', type: 'group', data: { kind: 'team_scope' } }, { id: 'inner', type: 'group', parentNode: 'outer', data: { kind: 'team_scope' } })
      input.nodes[0].parentNode = 'inner'
    }
    if (reason === 'scope conflict') input.nodes[0].data.replication = { scope: 'per_team' }
    expect(() => expandScenarioReplication(input)).toThrow(/canvas|source|scope|roster|domain|users/i)
  })

  it.each(['per_user', 'per_team', 'unknown'])('rejects unconfigured legacy scope %s before emitting a misleading single instance', scope => {
    const input = fixture()
    delete input.scenario.replication
    input.nodes[0].data.replication = { scope }
    expect(() => emitConcreteScenario(input)).toThrow(/replicat/i)
  })

  it('rejects more than 64 expanded VMs before requesting assignments', () => {
    const input = fixture()
    input.scenario.replication.teams = [{ id: 'blue', users: Array.from({ length: 33 }, (_, index) => ({ id: `user-${index}` })) }]
    input.nodes.push({ id: 'vm2', type: 'vm', data: {} })
    input.edges.push({ id: 'nic-other', source: 'vm2', target: 'net1' })
    input.scenario.vms.push({ ...input.scenario.vms[0], node_id: 'vm2', nics: [{ key: 'nic-other', network_id: 'net1', ip: '' }] })
    input.scenario.replication.node_scopes.vm2 = 'per_user'
    input.scenario.replication.vm_assignments = {}
    expect(() => expandScenarioReplication(input)).toThrow(/64.*VM|VM.*64/i)
  })

  it('rejects shared VM to scoped network fan-out and team VM to user network ambiguity', () => {
    const input = fixture()
    input.scenario.replication.node_scopes.vm1 = 'shared'
    expect(() => expandScenarioReplication(input)).toThrow(/shared.*scoped/i)
    input.scenario.replication.node_scopes.vm1 = 'per_team'
    input.scenario.replication.network_scopes.net1 = 'per_user'
    expect(() => expandScenarioReplication(input)).toThrow(/team.*user|scope/i)
  })


  it('keeps parallel links and their primary NIC identity when edges and secondary rows reorder', () => {
    const input = fixture()
    const vm = input.scenario.vms[0]
    vm.primary_nic_key = 'nic-primary'
    for (const [index, nicKey] of ['nic-z', 'nic-a'].entries()) {
      input.edges.push({ id: nicKey, source: 'vm1', target: 'net1' })
      vm.nics.push({ key: nicKey, network_id: 'net1', ip: '' })
      for (const assigned of Object.values(input.scenario.replication.vm_assignments)) {
        const ip = assigned.nics['nic-primary'].ip.split('.')
        ip[3] = String(Number(ip[3]) + (index + 1) * 30)
        assigned.nics[nicKey] = { ip: ip.join('.') }
      }
    }
    const first = emitConcreteScenario(input)
    const instance = JSON.parse(first.files['scenarios/replicated/manifest/scenario_instances.json']).instances[0]
    expect(instance.nics.map(nic => nic.nic_key)).toEqual(['nic-primary', 'nic-a', 'nic-z'])
    input.edges.reverse()
    vm.nics.reverse()
    expect(emitConcreteScenario(input).files).toEqual(first.files)
    delete vm.nics[0].key
    expect(() => emitConcreteScenario(input)).toThrow(/parallel|exact.*edge/i)
  })

  it('gives every user its own reviewed subnet and binds bundle targets to all literal hostnames', () => {
    const input = fixture()
    input.scenario.replication.network_scopes.net1 = 'per_user'
    let index = 20
    for (const team of input.scenario.replication.teams) for (const user of team.users) {
      const subnet = `10.42.${index++}`
      input.scenario.replication.network_assignments[key('net', 'net1', team.id, user.id)] = { vnet: `user${index}`, subnet: `${subnet}.0/24`, gateway: `${subnet}.1`, snat: user.id === 'alice' }
      input.scenario.replication.vm_assignments[key('vm', 'vm1', team.id, user.id)].nics['nic-primary'].ip = `${subnet}.10`
    }
    const resolution = { source_id: 'sdn', source_sha: 'a'.repeat(40), path: 'bundles/firewall/in_vm/os_firewall.baseline.ssh',
      entrypoint: 'firewall/in_vm/os_firewall.baseline.ssh/main.yml', bundle_kind: 'GROUP', target_kind: 'VM', proof_kind: 'content_match',
      params: [{ name: 'target_group', type: 'string', target: true, required: true }], target_vars: ['target_group'],
      runtime: { fingerprint: 'b'.repeat(64), proof: 'server-sealed-proof' } }
    input.scenario.content.push({ id: 'firewall', kind: 'bundle', target_node: 'vm1', path: resolution.entrypoint, resolution })
    const result = emitConcreteScenario(input)
    const mapping = JSON.parse(result.files['scenarios/replicated/manifest/scenario_instances.json'])
    expect(mapping.networks).toHaveLength(3)
    for (const vm of mapping.instances) {
      const network = mapping.networks.find(network => network.instance_key === vm.nics[0].network_instance_key)
      expect([network.team_id, network.user_id]).toEqual([vm.team_id, vm.user_id])
    }
    const bundles = JSON.parse(result.files['scenarios/replicated/manifest/scenario_bundles.json']).attachments
    expect(bundles.map(item => item.inventory_host)).toEqual(mapping.instances.map(vm => vm.hostname))
    expect(bundles.every(item => JSON.stringify(item.resolution) === JSON.stringify(resolution))).toBe(true)
    const configure = parse(result.files['scenarios/replicated/configure.yml'])
    expect(configure.slice(3).map(play => play.vars.target_group)).toEqual(mapping.instances.map(vm => vm.hostname))
    expect(Object.keys(result.files).filter(path => path.endsWith('example.txt'))).toHaveLength(1)
    expect(JSON.parse(result.files['scenarios/replicated/manifest/scenario_networks.json']).vnets.filter(net => net.snat)).toHaveLength(1)
  })

  it('warns when replicated users explicitly share one subnet and its internet policy', () => {
    const input = fixture()
    input.scenario.replication.network_scopes.net1 = 'shared'
    for (const [index, assigned] of Object.values(input.scenario.replication.vm_assignments).entries()) assigned.nics['nic-primary'].ip = `10.42.9.${11 + index}`
    expect(expandScenarioReplication(input).warnings.join(' ')).toMatch(/share.*subnet.*internet|internet.*shared/i)
  })

  it.each(['team limit', 'user limit'])('bounds unused rosters before expansion: %s', reason => {
    const input = fixture()
    input.scenario.replication.node_scopes.vm1 = 'shared'
    input.scenario.replication.network_scopes.net1 = 'shared'
    input.scenario.replication.teams = reason === 'team limit'
      ? Array.from({ length: 65 }, (_, index) => ({ id: `team-${index}`, users: [] }))
      : [{ id: 'one', users: Array.from({ length: 65 }, (_, index) => ({ id: `user-${index}` })) }]
    expect(() => expandScenarioReplication(input)).toThrow(/64.*team|64.*user|roster.*64/i)
  })

  it('requires exact keyed NIC assignments and does not hide extra assignment fields', () => {
    const input = fixture()
    Object.values(input.scenario.replication.vm_assignments)[0].nics['removed-nic'] = { ip: '10.42.10.50' }
    expect(() => expandScenarioReplication(input)).toThrow(/NIC assignment.*match|unknown.*NIC/i)
  })


  it('keeps explicit existing bridges up to 15 characters and rejects managed SNAT or longer names', () => {
    const input = fixture()
    input.scenario.network_mode = 'existing_bridge'
    input.scenario.replication.network_scopes.net1 = 'shared'
    input.scenario.networks[0].vnet = 'vmbr12345678901'
    for (const [index, assigned] of Object.values(input.scenario.replication.vm_assignments).entries()) assigned.nics['nic-primary'].ip = `10.42.9.${11 + index}`
    const output = emitConcreteScenario(input)
    expect(JSON.parse(output.files['scenarios/replicated/manifest/scenario_networks.json']).bridges).toEqual(['vmbr12345678901'])
    input.scenario.networks[0].snat = true
    expect(() => emitConcreteScenario(input)).toThrow(/existing bridge.*SNAT|SNAT.*existing bridge/i)
    input.scenario.networks[0].snat = false
    input.scenario.networks[0].vnet += '12'
    expect(() => emitConcreteScenario(input)).toThrow(/15|bridge.*name/i)
  })


  it('bounds 32 networks and 256 total NICs before requiring assignments', () => {
    const input = fixture()
    input.scenario.replication.node_scopes.vm1 = 'per_team'
    input.scenario.replication.teams = Array.from({ length: 33 }, (_, index) => ({ id: `team-${index}`, users: [] }))
    expect(() => expandScenarioReplication(input)).toThrow(/32.*network|network.*32/i)
    input.scenario.replication.node_scopes.vm1 = 'per_user'
    input.scenario.replication.teams = [{ id: 'blue', users: Array.from({ length: 9 }, (_, index) => ({ id: `user-${index}` })) }]
    input.scenario.vms[0].nics = Array.from({ length: 32 }, (_, index) => ({ key: `nic-${index}`, network_id: 'net1', ip: '' }))
    input.edges = input.scenario.vms[0].nics.map(nic => ({ id: nic.key, source: 'vm1', target: 'net1' }))
    expect(() => expandScenarioReplication(input)).toThrow(/256.*NIC|NIC.*256/i)
  })

  it('keeps bounded collision-checked hostnames independent of roster display labels', () => {
    const input = fixture()
    input.scenario.vms[0].vm_name = 'workstation-'.repeat(12)
    const first = emitConcreteScenario(input)
    const names = JSON.parse(first.files['scenarios/replicated/manifest/scenario_vms.json']).vms.map(vm => vm.vm_name)
    expect(names.every(name => name.length <= 63 && /^[a-zA-Z][a-zA-Z0-9-]+$/.test(name))).toBe(true)
    expect(new Set(names).size).toBe(3)
    input.scenario.replication.teams[0].label = 'Équipe bleue'
    input.scenario.replication.teams[0].users[0].label = '利用者'
    expect(emitConcreteScenario(input).files).toEqual(first.files)
    Object.values(input.scenario.replication.network_assignments)[1].vnet = 'blue1'
    expect(() => emitConcreteScenario(input)).toThrow(/duplicate network/i)
  })

  it.each(['Unicode', 'oversized', 'user without team'])('rejects unsupported identity tuples: %s', reason => {
    expect(() => scenarioInstanceKey('vm', reason === 'Unicode' ? 'équipe' : 'course-1', reason === 'oversized' ? 'a'.repeat(129) : 'vm1', null, reason === 'user without team' ? 'alice' : null)).toThrow(/ASCII|128|team/i)
  })

})

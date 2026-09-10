import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { emitConcreteScenario, createScenarioDraft } from '@/services/concreteScenario'

function fixture() {
  return {
    nodes: [{ id: 'vm1', type: 'vm', data: { config: { name: 'demo-vm' } } },
      { id: 'net1', type: 'network-segment', data: { config: {} } }],
    edges: [{ source: 'vm1', target: 'net1' }], attachments: [],
    scenario: {
      label: 'demo', network_mode: 'sdn', zone: 'r42demo',
      networks: [{ id: 'net1', vnet: 'demo1', subnet: '10.42.10.0/24', gateway: '10.42.10.1', snat: true }],
      vms: [{ node_id: 'vm1', vm_id: 3101, vm_name: 'demo-vm', template_vm_id: 9232,
        network_id: 'net1', ip: '10.42.10.10', ssh_user: 'alice' }],
      content: [
        { id: 'file', kind: 'file', target_node: 'vm1', path: 'content/message.txt', destination: '/tmp/message.txt', mode: '0644' },
        { id: 'script', kind: 'script', target_node: 'vm1', path: 'content/setup.sh' },
        { id: 'playbook', kind: 'playbook', target_node: 'vm1', path: 'content/configure.yml' },
      ],
    },
    files: { 'scenarios/demo/content/message.txt': 'hello\n',
      'scenarios/demo/content/setup.sh': '#!/bin/sh\nset -eu\ncat /tmp/message.txt\n',
      'scenarios/demo/content/configure.yml': '- hosts: "{{ global_vm_ssh_name }}"\n  gather_facts: false\n  tasks:\n    - ansible.builtin.debug:\n        msg: complete\n' },
  }
}

describe('concrete scenario emitter', () => {
  it('emits matching inventory, VM manifest, ordered SDN/bootstrap/content stages and a content-only entrypoint', () => {
    const input = fixture()
    const { files } = emitConcreteScenario(input)
    const yaml = path => parse(files[`scenarios/demo/${path}`])
    expect(yaml('main.yml').map(play => play['ansible.builtin.import_playbook'])).toEqual([
      '00_networks.yml', '01_vm_bootstrap.yml', 'configure.yml',
    ])
    expect(yaml('00_networks.yml')[0]).toEqual({
      'ansible.builtin.import_playbook': "{{ lookup('env', 'RANGE42_BUNDLE_DIR') }}/proxmox/sdn_network.bootstrap/main.yml",
      vars: { BUNDLE_SDN_ZONE: 'r42demo', BUNDLE_SDN_VNETS: [{ vnet: 'demo1', subnet: '10.42.10.0/24', gateway: '10.42.10.1', snat: true }] },
    })
    const inventory = yaml('hosts.yml').all.children
    expect(inventory.proxmox.hosts['r42-proxmox'].ansible_connection).toBe('local')
    expect(inventory.proxmox_cli.hosts['r42-proxmox-cli'].ansible_host).toBe('{{ r42_proxmox_address }}')
    expect(inventory.scenario_guests.hosts['demo-vm'].ansible_host).toBe('10.42.10.10')
    const manifest = JSON.parse(files['scenarios/demo/manifest/scenario_vms.json'])
    expect(manifest.vms).toEqual([{ vm_id: 3101, vm_name: 'demo-vm', ip: '10.42.10.10', role: 'vm', bridge: 'demo1', template_vm_id: 9232 }])
    expect(yaml('01_vm_bootstrap.yml')[0].vars).toMatchObject({
      global_vm_ssh_name: 'demo-vm', global_vm_id: 3101, global_vm_ci_ip: '10.42.10.10',
      global_vm_net_virtio_bridge: 'demo1', global_template_vm_id: 9232,
      global_vm_description: 'range42-deployment:{{ r42_deployment_id }}',
    })
    const configure = yaml('configure.yml')
    expect(configure[0].hosts).toBe('demo-vm')
    expect(configure[0].tasks[0]['ansible.builtin.copy']).toMatchObject({ src: '{{ playbook_dir }}/content/message.txt', dest: '/tmp/message.txt' })
    expect(configure[1].tasks[0]['ansible.builtin.script']).toEqual({ cmd: '{{ playbook_dir }}/content/setup.sh' })
    expect(configure[2]).toMatchObject({ 'ansible.builtin.import_playbook': 'content/configure.yml', vars: { global_vm_ssh_name: 'demo-vm' } })
    expect(files['scenarios/demo/content/message.txt']).toBe('hello\n')
    expect(JSON.parse(files['scenarios/demo/manifest/scenario_networks.json'])).toEqual({ mode: 'sdn', zone: 'r42demo', vnets: input.scenario.networks.map(({ id: _id, ...network }) => network) })
    expect(JSON.stringify(files)).not.toContain('_universal')
    expect(JSON.stringify(input)).toEqual(JSON.stringify(fixture()))
  })

  it('uses workspace host-key trust for both the jump host and guest connections', () => {
    const { files } = emitConcreteScenario(fixture())
    const inventory = parse(files['scenarios/demo/hosts.yml']).all.children
    for (const host of [inventory.proxmox_cli.hosts['r42-proxmox-cli'], inventory.scenario_guests.hosts['demo-vm']]) {
      expect(host.ansible_ssh_common_args).toContain('StrictHostKeyChecking=accept-new')
      expect(host.ansible_ssh_common_args).toContain('UserKnownHostsFile={{ deployer_cli_user_ssh_known_hosts | quote }}')
    }
    const guestOptions = inventory.scenario_guests.hosts['demo-vm'].ansible_ssh_common_args
    expect(guestOptions).toContain('ProxyCommand=')
    expect(guestOptions).not.toContain('ProxyJump=')
    expect(guestOptions.match(/StrictHostKeyChecking=accept-new/g)).toHaveLength(2)
  })

  it('generates VM-only teardown with runtime ownership checks and waits for completed deletion', () => {
    const { files } = emitConcreteScenario(fixture())
    const teardown = parse(files['scenarios/demo/teardown.yml'])
    const tasks = teardown[0].tasks
    expect(tasks[0]['ansible.builtin.uri'].url).toContain('/cluster/resources?type=vm')
    const owned = tasks[1].block
    const ownerGuard = owned.find(task => task['ansible.builtin.assert']?.fail_msg?.includes('ownership'))
    expect(ownerGuard['ansible.builtin.assert'].that.join(' ')).toContain('range42-deployment:')
    const stop = owned.findIndex(task => task.vars?.proxmox_vm_action === 'vm_stop')
    const remove = owned.findIndex(task => task.vars?.proxmox_vm_action === 'vm_delete')
    expect(owned.indexOf(ownerGuard)).toBeLessThan(stop)
    expect(stop).toBeLessThan(remove)
    expect(owned.slice(remove + 1).some(task => task.until?.includes('stopped'))).toBe(true)
    expect(files['scenarios/demo/teardown.yml']).not.toContain('network_delete')
    expect(tasks[1].when).toContain('3101')
  })

  it('adds newly drawn VMs when reopening configuration while preserving configured rows', () => {
    const input = fixture()
    input.nodes.push({ id: 'vm2', type: 'vm', data: { config: { name: 'new-vm' } } })
    input.edges.push({ source: 'vm2', target: 'net1' })
    const draft = createScenarioDraft({ name: 'Demo', scenario: input.scenario }, input.nodes, input.edges)
    expect(draft.vms).toHaveLength(2)
    expect(draft.vms[0].vm_id).toBe(3101)
    expect(draft.vms[1].vm_name).toBe('new-vm')
  })

  it('applies declared public variable overrides with explicit per-step values taking precedence', () => {
    const input = fixture()
    input.baseDoc = { env: [{ name: 'MESSAGE', default: 'default message' }, { name: 'COUNT', default: 2 }] }
    input.overlay = { param_overrides: { env: { MESSAGE: 'project override' } } }
    input.scenario.content[0].vars = { MESSAGE: 'step override' }
    const configure = parse(emitConcreteScenario(input).files['scenarios/demo/configure.yml'])
    expect(configure[0].vars).toMatchObject({ MESSAGE: 'step override', COUNT: 2, global_vm_ssh_name: 'demo-vm' })
    expect(configure[1].vars).toMatchObject({ MESSAGE: 'project override', COUNT: 2 })
    expect(configure[2].vars.MESSAGE).toBe('project override')
  })

  it.each([
    ['project secret override', input => { input.baseDoc = { env: [{ name: 'PASSWORD', secret: true }] }; input.overlay = { param_overrides: { env: { PASSWORD: 'secret-value' } } } }, /secret/i],
    ['secret default', input => { input.baseDoc = { env: [{ name: 'PASSWORD', secret: true, default: 'secret-value' }] } }, /secret/i],
    ['secret step override', input => { input.baseDoc = { env: [{ name: 'PASSWORD', secret: true }] }; input.scenario.content[0].vars = { PASSWORD: 'secret-value' } }, /secret/i],
    ['runtime connection override', input => { input.baseDoc = { env: [{ name: 'ansible_host', default: 'bad-host' }] } }, /reserved/i],
    ['ownership override', input => { input.scenario.content[0].vars = { r42_deployment_id: 'different-deployment' } }, /reserved/i],
    ['undeclared project override', input => { input.overlay = { param_overrides: { env: { UNKNOWN: 'value' } } } }, /declared/i],
  ])('rejects %s before any scenario can be saved', (_name, mutate, message) => {
    const input = fixture()
    mutate(input)
    expect(() => emitConcreteScenario(input)).toThrow(message)
  })

  it('defaults a new draft to SDN and only infers existing canvas identities and configured values', () => {
    const input = fixture()
    const draft = createScenarioDraft({ name: 'Demo lab' }, input.nodes, input.edges)
    expect(draft.label).toBe('demo_lab')
    expect(draft.network_mode).toBe('sdn')
    expect(draft.vms[0]).toMatchObject({ node_id: 'vm1', vm_name: 'demo-vm', network_id: 'net1' })
    expect(draft.vms[0].vm_id).toBe('')
    expect(draft.vms[0].template_vm_id).toBe('')
  })

  it('supports explicit existing bridges without invoking SDN', () => {
    const input = fixture()
    input.scenario.network_mode = 'existing_bridge'
    input.scenario.networks[0].vnet = 'vmbr142'
    const { files } = emitConcreteScenario(input)
    expect(files['scenarios/demo/main.yml']).not.toContain('00_networks.yml')
    expect(files['scenarios/demo/00_networks.yml']).toBeUndefined()
    expect(JSON.parse(files['scenarios/demo/manifest/scenario_networks.json'])).toEqual({ mode: 'existing_bridge', bridges: ['vmbr142'] })
  })

  it.each(['main.yml', 'configure.yml', 'hosts.yml', 'teardown.yml', 'manifest/scenario_vms.json'])('rejects content that would be overwritten by generated %s', path => {
    const input = fixture()
    const generated = emitConcreteScenario(input)
    input.files = generated.files
    input.generatedPaths = generated.generatedPaths
    input.scenario.content[0].path = path
    input.files[`scenarios/demo/${path}`] = 'authored content that must not disappear\n'
    expect(() => emitConcreteScenario(input)).toThrow(/content path.*reserved/i)
    expect(input.files[`scenarios/demo/${path}`]).toBe('authored content that must not disappear\n')
  })

  it.each([
    ['duplicate VMIDs', input => input.scenario.vms.push({ ...input.scenario.vms[0], node_id: 'vm2' }), /VMID|canvas/],
    ['template target collision', input => { input.scenario.vms[0].template_vm_id = 3101 }, /template/i],
    ['network host address as subnet', input => { input.scenario.networks[0].subnet = '10.42.10.3/24' }, /subnet/i],
    ['VM outside subnet', input => { input.scenario.vms[0].ip = '10.42.11.10' }, /subnet/i],
    ['gateway used by VM', input => { input.scenario.vms[0].ip = '10.42.10.1' }, /gateway/i],
    ['unsafe path', input => { input.scenario.content[0].path = '../secrets' }, /path/i],
    ['missing script', input => { delete input.files['scenarios/demo/content/setup.sh'] }, /missing/i],
    ['unbound playbook hosts', input => { input.files['scenarios/demo/content/configure.yml'] = '- hosts: all\n  tasks: []\n' }, /hosts/i],
    ['unsupported canvas node', input => { input.nodes[0].type = 'lxc' }, /lxc/i],
    ['replicated canvas', input => { input.nodes[0].data.replication = { scope: 'per_team' } }, /replicat/i],
    ['unhandled attachment', input => { input.attachments.push({ source: { kind: 'external_git' } }) }, /attachment/i],
    ['multiple NICs', input => { input.edges.push({ source: 'net1', target: 'vm1' }) }, /network|NIC/i],
  ])('rejects %s instead of silently omitting it', (_name, mutate, pattern) => {
    const input = fixture()
    mutate(input)
    expect(() => emitConcreteScenario(input)).toThrow(pattern)
  })
})

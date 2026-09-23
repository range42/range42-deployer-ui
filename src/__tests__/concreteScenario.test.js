import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { assetFromBytes } from '@/services/projectFiles'
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
  it.each([{ enabled: 'false' }, { enabled: true, arm_vms: 'YES' }, { enabled: true, prepare_management_access: 1 }])('refuses non-boolean firewall choices rather than silently changing intent: %j', firewall => {
    const input = fixture()
    input.scenario.firewall = firewall
    expect(() => emitConcreteScenario(input)).toThrow(/firewall choices/i)
  })

  it('retains but refuses shared management preparation when the selected backend has not authorized it', () => {
    const input = fixture()
    input.scenario.firewall = { enabled: true, prepare_management_access: true, arm_vms: false }
    input.runtimeCapabilities = { version: 1, available: true, contract: 'native-sdn-20260921', bootstrap_features: [], management_access_available: false }
    expect(() => emitConcreteScenario(input)).toThrow(/management rules/)
    expect(input.scenario.firewall.prepare_management_access).toBe(true)
  })
  it('orders reviewed native firewall stages around bootstrap and configuration, with arming off by default', () => {
    const input = fixture()
    input.scenario.firewall = { enabled: true, prepare_management_access: false, arm_vms: false, ssh_mode: 'inherit' }
    const files = emitConcreteScenario(input).files
    expect(parse(files['scenarios/demo/main.yml']).map(play => play['ansible.builtin.import_playbook'])).toEqual([
      '00_firewall_pre.yml', '00_networks.yml', '01_vm_bootstrap.yml', '02_firewall_guests.yml', 'configure.yml', '99_firewall_finalize.yml',
    ])
    expect(JSON.parse(files['scenarios/demo/manifest/scenario_firewall.json'])).toEqual({
      version: 1, prepare_management_access: false, arm_vms: false, ssh_sources: null,
    })
    expect(files['scenarios/demo/99_firewall_finalize.yml']).toContain('FIREWALL_ARM_VMS')
    expect(files['scenarios/demo/00_firewall_pre.yml']).toContain('r42_fw_prepare_management_access')
    expect(files['scenarios/demo/02_firewall_guests.yml']).toContain('range42-deployment:')
  })

  it('uses the exact declared CIDRs for restricted SSH without inventing template addresses', () => {
    const input = fixture()
    input.scenario.networks[0].subnet = '10.42.10.0/23'
    input.scenario.firewall = { enabled: true, prepare_management_access: false, arm_vms: true, ssh_mode: 'restricted', ssh_sources: '203.0.113.7/32' }
    const files = emitConcreteScenario(input).files
    expect(JSON.parse(files['scenarios/demo/manifest/scenario_firewall.json']).ssh_sources).toEqual(['203.0.113.7/32'])
    expect(files['scenarios/demo/02_firewall_guests.yml']).toContain('10.42.10.0/23')
    expect(files['scenarios/demo/02_firewall_guests.yml']).not.toContain('ssh_all_vms')
    expect(JSON.parse(files['scenarios/demo/manifest/scenario_vms.json']).templates).toEqual([{ vm_id: 9232 }])
  })

  it.each(['203.0.113.7/24', '{{ secret }}', 'bad'])('refuses unsafe source restriction %s', source => {
    const input = fixture()
    input.scenario.firewall = { enabled: true, ssh_mode: 'restricted', ssh_sources: source }
    expect(() => emitConcreteScenario(input)).toThrow(/SSH sources/)
  })

  it.each([
    ['CPU and memory overrides', { cores: 4 }, 'resources'],
    ['disk resizing', { disk_gb: 50 }, 'disk_resize'],
    ['multiple NICs', { nics: [{ network_id: 'net1', ip: '10.42.10.10' }, { network_id: 'net1', ip: '10.42.10.11' }] }, 'extra_nics'],
  ])('refuses %s unsupported by the selected runtime without altering the draft', (_label, choices, feature) => {
    const input = fixture()
    Object.assign(input.scenario.vms[0], choices)
    if (feature === 'extra_nics') input.edges.push({ source: 'vm1', target: 'net1' })
    input.runtimeCapabilities = { version: 1, available: true, contract: 'native-sdn-20260921', bootstrap_features: [] }
    const saved = structuredClone(input)
    expect(() => emitConcreteScenario(input)).toThrow(new RegExp(feature))
    expect(input).toEqual(saved)
  })

  it('emits template inheritance for a recognized native runtime without private bootstrap inputs', () => {
    const input = fixture()
    input.runtimeCapabilities = { version: 1, available: true, bootstrap_features: [] }
    const output = emitConcreteScenario(input)
    expect(output.files['scenarios/demo/01_vm_bootstrap.yml']).not.toMatch(/global_vm_extra_config|global_vm_disk/)
  })

  it('excludes explicit reference lines between resources from deployment', () => {
    const input = fixture()
    const expected = emitConcreteScenario(input).files
    input.edges.push({ id: 'reference', source: 'vm1', target: 'net1', data: { reference_only: true }, label: 'Reference' })
    expect(emitConcreteScenario(input).files).toEqual(expected)
  })

  it('keeps note text and annotation connections out of executable files', () => {
    const input = fixture()
    const expected = emitConcreteScenario(input).files
    input.nodes.push({ id: 'note', type: 'note', data: { config: { name: 'Review', text: 'Annotation only' } } })
    input.edges.push({ id: 'annotation', source: 'note', target: 'vm1' })
    expect(emitConcreteScenario(input).files).toEqual(expected)
    expect(input.nodes.at(-1).type).toBe('note')
    expect(input.edges.at(-1).id).toBe('annotation')
  })

  it('records reviewed SSH and DNS preferences on every literal VM', () => {
    const input = fixture()
    Object.assign(input.scenario.vms[0], { ssh_user: 'operator', dns_servers: '10.42.10.2, 1.1.1.1', dns_search_domain: 'lab.example' })
    const { files } = emitConcreteScenario(input)
    const manifest = JSON.parse(files['scenarios/demo/manifest/scenario_vms.json'])
    expect(manifest.guest_preferences_version).toBe(2)
    expect(manifest.vms[0]).toMatchObject({ storage: null, cloud_init: { ssh_user: 'operator', dns_servers: ['10.42.10.2', '1.1.1.1'], dns_search_domain: 'lab.example' } })
    expect(parse(files['scenarios/demo/01_vm_bootstrap.yml'])[0].vars).toMatchObject({ default_admin_vm_ci_user: 'operator', global_vm_ci_dns_ips: '10.42.10.2 1.1.1.1', vm_ci_dns_domain: 'lab.example' })
    expect(parse(files['scenarios/demo/hosts.yml']).all.children.scenario_guests.hosts['demo-vm'].ansible_user).toBe('operator')
    input.scenario.vms[0].dns_servers = ''
    input.scenario.vms[0].dns_search_domain = ''
    const inherited = JSON.parse(emitConcreteScenario(input).files['scenarios/demo/manifest/scenario_vms.json'])
    expect(inherited.vms[0].cloud_init).toEqual({ ssh_user: 'operator', dns_servers: null, dns_search_domain: null })
  })
  it.each([
    { dns_servers: '8.8.8.999' }, { dns_servers: '{{ lookup("env", "SECRET") }}' },
    { dns_servers: '1.1.1.1 2.2.2.2 3.3.3.3 4.4.4.4' }, { dns_servers: ['1.1.1.1'] },
    { dns_search_domain: 'bad domain' }, { dns_search_domain: '-bad.example' }, { dns_search_domain: '{{ domain }}' },
  ])('refuses unsupported DNS preferences %j', preferences => {
    const input = fixture(); Object.assign(input.scenario.vms[0], preferences)
    expect(() => emitConcreteScenario(input)).toThrow(/DNS|domain/i)
  })
  it('prefills cloud-init preferences from new canvas nodes without replacing saved choices', () => {
    const input = fixture()
    Object.assign(input.nodes[0].data.config, { ssh_user: 'operator', dns_servers: '10.42.10.2', dns_search_domain: 'lab.example' })
    const fresh = createScenarioDraft({ name: 'Demo' }, input.nodes, input.edges)
    expect(fresh.vms[0]).toMatchObject({ ssh_user: 'operator', dns_servers: '10.42.10.2', dns_search_domain: 'lab.example' })
    Object.assign(input.scenario.vms[0], { ssh_user: 'reviewed', dns_servers: '', dns_search_domain: '' })
    expect(createScenarioDraft({ scenario: input.scenario }, input.nodes, input.edges).vms[0]).toMatchObject({ ssh_user: 'reviewed', dns_servers: '', dns_search_domain: '' })
  })
  it('keeps binary file bytes outside YAML and copies the checked-out asset by source path', () => {
    const input = fixture()
    const asset = assetFromBytes(Uint8Array.of(0, 255, 128, 10))
    input.files['scenarios/demo/content/message.txt'] = asset
    const result = emitConcreteScenario(input)
    expect(result.files['scenarios/demo/content/message.txt']).toEqual(asset)
    expect(parse(result.files['scenarios/demo/configure.yml'])[0].tasks[0]['ansible.builtin.copy']).toEqual({
      src: '{{ playbook_dir }}/content/message.txt', dest: '/tmp/message.txt', mode: '0644',
    })
    expect(result.files['scenarios/demo/configure.yml']).not.toContain(asset.content)
  })
  it.each(['script', 'playbook'])('rejects binary %s input rather than sending bytes to a text interpreter', kind => {
    const input = fixture()
    const item = input.scenario.content.find(item => item.kind === kind)
    input.files[`scenarios/demo/${item.path}`] = assetFromBytes(Uint8Array.of(0, 255))
    expect(() => emitConcreteScenario(input)).toThrow(/must be text/i)
  })

  it('binds a verified bundle to its VM and saves exact source and runtime provenance', () => {
    const input = fixture()
    input.baseDoc = { env: [{ name: 'UNRELATED_PROJECT_VALUE', default: 'must not leak' }] }
    const resolution = { source_id: 'sdn', source_sha: 'a'.repeat(40), path: 'bundles/generic/software.demo',
      entrypoint: 'generic/software.demo/main.yml', bundle_kind: 'VM', proof_kind: 'content_match',
      params: [{ name: 'PORT', type: 'int' }, { name: 'global_vm_ssh_name', target: true }],
      target_vars: ['global_vm_ssh_name', 'global_vm_ci_ip'], runtime: { fingerprint: 'b'.repeat(64), proof: 'server-sealed-proof' } }
    input.scenario.content.push({ id: 'bundle', kind: 'bundle', target_node: 'vm1', path: resolution.entrypoint, vars: { PORT: 8080 }, resolution })
    const { files } = emitConcreteScenario(input)
    expect(JSON.parse(files['scenarios/demo/manifest/scenario_bundles.json'])).toEqual({ version: 1, attachments: [
      { vm_id: 3101, inventory_host: 'demo-vm', resolution, parameters: { PORT: 8080 } },
    ] })
    expect(parse(files['scenarios/demo/configure.yml']).at(-1)).toEqual({
      'ansible.builtin.import_playbook': "{{ lookup('env', 'RANGE42_BUNDLE_DIR') }}/generic/software.demo/main.yml",
      vars: { PORT: 8080, global_vm_ssh_name: 'demo-vm', global_vm_ci_ip: '10.42.10.10' },
    })
    input.scenario.content.at(-1).path = 'generic/something-else/main.yml'
    expect(() => emitConcreteScenario(input)).toThrow(/resolve|provenance|verified/i)
  })

  it('binds a verified group bundle to exactly one VM without exposing a group selector', () => {
    const input = fixture()
    const resolution = { source_id: 'sdn', source_sha: 'a'.repeat(40), path: 'bundles/firewall/in_vm/os_firewall.baseline.ssh',
      entrypoint: 'firewall/in_vm/os_firewall.baseline.ssh/main.yml', bundle_kind: 'GROUP', target_kind: 'VM', proof_kind: 'content_match',
      params: [{ name: 'target_group', type: 'string', target: true, required: true }], target_vars: ['target_group'],
      runtime: { fingerprint: 'b'.repeat(64), proof: 'server-sealed-proof' } }
    input.scenario.content = [{ id: 'firewall', kind: 'bundle', target_node: 'vm1', path: resolution.entrypoint, vars: {}, resolution }]
    const result = emitConcreteScenario(input)
    expect(parse(result.files['scenarios/demo/configure.yml'])[0].vars).toEqual({ target_group: 'demo-vm' })
    expect(JSON.parse(result.files['scenarios/demo/manifest/scenario_bundles.json']).attachments[0].resolution.bundle_kind).toBe('GROUP')
    input.scenario.content[0].vars.target_group = 'all'
    expect(() => emitConcreteScenario(input)).toThrow(/managed/i)
    delete input.scenario.content[0].vars.target_group
    delete resolution.target_kind
    expect(() => emitConcreteScenario(input)).toThrow(/verified|resolve/i)
  })
  it('requires resolving a bundle from the library before executing an installed path', () => {
    const input = fixture()
    input.scenario.content.push({ id: 'unverified', kind: 'bundle', target_node: 'vm1', path: 'generic/systems.baseline.default/main.yml' })
    expect(() => emitConcreteScenario(input)).toThrow(/library|resolve|verified/i)
  })

  it('emits reviewed clone storage separately for selected and inherited VMs', () => {
    const input = fixture()
    input.scenario.vms[0].storage = 'fast-pool'
    input.nodes.push({ id: 'vm2', type: 'vm', data: { config: {} } })
    input.edges.push({ source: 'vm2', target: 'net1' })
    input.scenario.vms.push({ ...input.scenario.vms[0], node_id: 'vm2', vm_id: 3102, vm_name: 'second', ip: '10.42.10.11', storage: '' })
    const { files } = emitConcreteScenario(input)
    const manifest = JSON.parse(files['scenarios/demo/manifest/scenario_vms.json'])
    expect(manifest.guest_preferences_version).toBe(1)
    expect(manifest.vms.map(vm => vm.storage)).toEqual(['fast-pool', null])
    const boot = parse(files['scenarios/demo/01_vm_bootstrap.yml'])
    expect(boot[0].vars.proxmox_dest_vm_storage_name).toBe('fast-pool')
    expect(boot[1].vars).not.toHaveProperty('proxmox_dest_vm_storage_name')
  })
  it('keeps old generated storage behavior unchanged until storage is explicitly reviewed', () => {
    const result = emitConcreteScenario(fixture())
    expect(JSON.parse(result.files['scenarios/demo/manifest/scenario_vms.json'])).not.toHaveProperty('guest_preferences_version')
  })
  it.each(['../fast', '{{ pool }}', 'bad pool', 'a'.repeat(65), 42])('refuses unsafe clone storage %j', storage => {
    const input = fixture(); input.scenario.vms[0].storage = storage
    expect(() => emitConcreteScenario(input)).toThrow(/storage/i)
  })
  it('prefills storage from the canvas while preserving a reviewed destination or inheritance', () => {
    const input = fixture(); input.nodes[0].data.config.storage = 'canvas-pool'
    expect(createScenarioDraft({ name: 'Demo' }, input.nodes, input.edges).vms[0].storage).toBe('canvas-pool')
    input.scenario.vms[0].storage = 'reviewed-pool'
    expect(createScenarioDraft({ scenario: input.scenario }, input.nodes, input.edges).vms[0].storage).toBe('reviewed-pool')
    input.scenario.vms[0].storage = ''
    expect(createScenarioDraft({ scenario: input.scenario }, input.nodes, input.edges).vms[0].storage).toBe('')
  })

  it('compiles multiple NICs and explicit resource overrides while retaining the management address', () => {
    const input = fixture()
    input.nodes.push({ id: 'net2', type: 'network-segment', data: { config: {} } })
    input.edges.push({ source: 'vm1', target: 'net2' })
    input.scenario.networks.push({ id: 'net2', vnet: 'demo2', subnet: '10.42.11.0/24', gateway: '10.42.11.1', snat: false })
    Object.assign(input.scenario.vms[0], { cores: 4, memory_mb: 4096, disk_gb: 32, disk_device: 'scsi0', nics: [
      { network_id: 'net1', ip: '10.42.10.10' },
      { network_id: 'net2', ip: '10.42.11.10' },
    ] })
    const { files } = emitConcreteScenario(input)
    const manifest = JSON.parse(files['scenarios/demo/manifest/scenario_vms.json'])
    expect(manifest.version).toBe(3)
    expect(manifest.vms[0]).toMatchObject({ ip: '10.42.10.10', bridge: 'demo1', cores: 4, memory_mb: 4096,
      nics: [{ index: 0, ip: '10.42.10.10', bridge: 'demo1' }, { index: 1, ip: '10.42.11.10', bridge: 'demo2' }] })
    expect(parse(files['scenarios/demo/01_vm_bootstrap.yml'])[0].vars).toMatchObject({
      global_vm_extra_config: { net1: 'virtio,bridge=demo2', ipconfig1: 'ip=10.42.11.10/24', cores: 4, memory: 4096 },
      global_vm_disk: { disk: 'scsi0', size_gb: 32 },
    })
    expect(parse(files['scenarios/demo/hosts.yml']).all.children.scenario_guests.hosts['demo-vm'].ansible_host).toBe('10.42.10.10')
  })

  it.each([
    ['fractional CPU', { cores: 1.5 }], ['zero memory', { memory_mb: 0 }],
    ['negative disk size', { disk_gb: -1 }], ['CD-ROM resize', { disk_gb: 32, disk_device: 'ide2' }],
  ])('rejects invalid resources: %s', (_label, resources) => {
    const input = fixture()
    Object.assign(input.scenario.vms[0], resources)
    expect(() => emitConcreteScenario(input)).toThrow(/CPU|memory|disk/i)
  })
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
    expect(manifest.vms).toMatchObject([{ vm_id: 3101, vm_name: 'demo-vm', ip: '10.42.10.10', role: 'vm', bridge: 'demo1', template_vm_id: 9232 }])
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
    expect(tasks[0]['ansible.builtin.uri'].validate_certs).toBe('{{ proxmox_api_validate_certs | default(true) }}')
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

  it('prefills new Scenario VM resources and explicit SNAT from configured catalog nodes', () => {
    const input = fixture()
    Object.assign(input.nodes[0].data.config, { cores: 6, memory: 6144, diskSize: '48G' })
    Object.assign(input.nodes[1].data.config, { cidr: '10.42.10.0/24', gateway: '10.42.10.1', snat: false })
    const draft = createScenarioDraft({ name: 'Catalog project' }, input.nodes, input.edges)
    expect(draft.vms[0]).toMatchObject({ cores: 6, memory_mb: 6144, disk_gb: 48 })
    expect(draft.networks[0]).toMatchObject({ subnet: '10.42.10.0/24', snat: false })
  })

  it('prefills canonical resource units without letting old UI aliases override them', () => {
    const input = fixture()
    Object.assign(input.nodes[0].data.config, { cores: 6, memory_mb: 6144, disk_gb: 48, memory: 1024, diskSize: '16G' })
    const draft = createScenarioDraft({ name: 'Canonical project' }, input.nodes, input.edges)
    expect(draft.vms[0]).toMatchObject({ cores: 6, memory_mb: 6144, disk_gb: 48 })
    expect(input.nodes[0].data.config).toMatchObject({ memory_mb: 6144, disk_gb: 48 })
  })

  it('keeps saved Scenario resources and SNAT authoritative after later canvas edits', () => {
    const input = fixture()
    Object.assign(input.nodes[0].data.config, { cores: 6, memory: 6144, diskSize: '48G' })
    Object.assign(input.scenario.vms[0], { cores: 2, memory_mb: 1024, disk_gb: 24 })
    input.nodes[1].data.config.snat = true
    input.scenario.networks[0].snat = false
    const draft = createScenarioDraft({ name: 'Saved project', scenario: input.scenario }, input.nodes, input.edges)
    expect(draft.vms[0]).toMatchObject({ cores: 2, memory_mb: 1024, disk_gb: 24 })
    expect(draft.networks[0].snat).toBe(false)
  })

  it('keeps inherited template resources unset in an existing saved Scenario', () => {
    const input = fixture()
    Object.assign(input.nodes[0].data.config, { cores: 6, memory: 6144, diskSize: '48G' })
    const draft = createScenarioDraft({ name: 'Saved project', scenario: input.scenario }, input.nodes, input.edges)
    expect(draft.vms[0]).not.toHaveProperty('cores')
    expect(draft.vms[0]).not.toHaveProperty('memory_mb')
    expect(draft.vms[0]).not.toHaveProperty('disk_gb')
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

  it('adds a newly connected NIC without losing the saved management address', () => {
    const input = fixture()
    input.nodes.push({ id: 'net2', type: 'network-segment', data: { config: {} } })
    input.edges.push({ source: 'vm1', target: 'net2' })
    const draft = createScenarioDraft({ name: 'Demo', scenario: input.scenario }, input.nodes, input.edges)
    expect(draft.vms[0].nics).toEqual([
      { network_id: 'net1', ip: '10.42.10.10' }, { network_id: 'net2', ip: '' },
    ])
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
    ['cloud-init override', input => { input.scenario.content[0].vars = { vm_ci_user: 'other-user' } }, /reserved/i],
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

  it('keeps exact saved NIC keys and their addresses when parallel canvas edges reorder', () => {
    const input = fixture()
    input.edges = [{ id: 'primary', source: 'vm1', target: 'net1' }, { id: 'secondary', source: 'vm1', target: 'net1' }]
    input.scenario.vms[0].primary_nic_key = 'primary'
    input.scenario.vms[0].nics = [{ key: 'primary', network_id: 'net1', ip: '10.42.10.10' }, { key: 'secondary', network_id: 'net1', ip: '10.42.10.11' }]
    const draft = createScenarioDraft({ name: 'Demo', scenario: input.scenario }, input.nodes, [...input.edges].reverse())
    expect(draft.vms[0].nics).toEqual(input.scenario.vms[0].nics)
    expect(draft.vms[0].primary_nic_key).toBe('primary')
  })

})

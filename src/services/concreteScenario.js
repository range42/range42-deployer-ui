import { validateFileMap } from '@/services/projectFiles'
import { parse, stringify } from 'yaml'
import { validateBundleParameters } from './bundleParameters.ts'

const BUNDLES = "{{ lookup('env', 'RANGE42_BUNDLE_DIR') }}"
const VAULT = "{{ lookup('env', 'RANGE42_ACTIVE_CONFIG_DIR') }}/secrets/default_vault.yml"
const HOST_KEY_OPTIONS = '-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile={{ deployer_cli_user_ssh_known_hosts | quote }}'
const PROXY_OPTIONS = `-o ProxyCommand={{ ("ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=" ~ (deployer_cli_user_ssh_known_hosts | quote) ~ " -W %h:%p " ~ ((r42_proxmox_ssh_user ~ "@" ~ r42_proxmox_address) | quote)) | quote }}`
const json = value => `${JSON.stringify(value, null, 2)}\n`
const yaml = value => stringify(value, { lineWidth: 0 })
const imported = (path, vars) => ({ 'ansible.builtin.import_playbook': path, ...(vars ? { vars } : {}) })

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}
function safePath(path) {
  requireValue(typeof path === 'string' && /^[A-Za-z0-9_./-]+$/.test(path)
    && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..'),
  `Invalid relative content path: ${path || '(empty)'}`)
}
function address(value, label) {
  const parts = String(value).split('.')
  requireValue(parts.length === 4 && parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255), `Invalid IPv4 ${label}: ${value}`)
  return parts.reduce((result, part) => result * 256 + Number(part), 0)
}
function subnet(value) {
  const [network, prefix, extra] = String(value).split('/')
  requireValue(!extra && /^(?:[1-9]|[12][0-9]|30)$/.test(prefix), `Invalid subnet: ${value}; use an IPv4 /1 through /30 network`)
  const start = address(network, 'subnet')
  const size = 2 ** (32 - Number(prefix))
  requireValue(start % size === 0, `Subnet must use its network address: ${value}`)
  return { start, end: start + size - 1, prefix }
}
function unique(values, label) {
  requireValue(new Set(values).size === values.length, `Duplicate ${label}`)
}
function nodeConfig(node) { return node.data?.config || {} }

function normalizedVms(rows) {
  return rows.map(vm => {
    requireValue(vm.nics === undefined || (Array.isArray(vm.nics) && vm.nics.length > 0 && vm.nics.length <= 32), `Choose 1–32 NICs for ${vm.vm_name}`)
    const nics = (vm.nics || [{ network_id: vm.network_id, ip: vm.ip }]).map(nic => ({ ...nic }))
    const value = { ...vm, nics, network_id: nics[0].network_id, ip: nics[0].ip }
    for (const [key, label, min, max] of [['cores', 'CPU cores', 1, 128], ['memory_mb', 'memory (MiB)', 128, 1048576], ['disk_gb', 'disk size (GiB)', 1, 65536]]) {
      if (value[key] === undefined || value[key] === null || value[key] === '') delete value[key]
      else {
        value[key] = Number(value[key])
        requireValue(Number.isInteger(value[key]) && value[key] >= min && value[key] <= max, `Invalid ${label} for ${vm.vm_name}: choose ${min}–${max}`)
      }
    }
    if (value.disk_gb !== undefined) {
      value.disk_device ||= 'scsi0'
      requireValue(/^(?:scsi(?:[0-9]|[12][0-9]|30)|virtio(?:[0-9]|1[0-5])|sata[0-5])$/.test(value.disk_device), `Choose a VM disk device, not a CD-ROM, for ${vm.vm_name}`)
    }
    return value
  })
}

function validateVariableName(name) {
  requireValue(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name), `Invalid Ansible variable name: ${name}`)
  requireValue(!/^(?:ansible_|proxmox_|r42_|global_vm_|global_template_|BUNDLE_SDN_|default_admin_vm_ci_|deployer_cli_|INFRASTRUCTURE_)/i.test(name)
    && !['__proto__', 'constructor', 'prototype', 'hostvars', 'groups', 'inventory_hostname', 'playbook_dir', 'role_path'].includes(name), `Reserved connection or ownership variable: ${name}`)
}

function configurationVariables(baseDoc, overlay) {
  const definitions = Array.isArray(baseDoc?.env) ? baseDoc.env : []
  const overrides = overlay?.param_overrides?.env || {}
  requireValue(typeof overrides === 'object' && !Array.isArray(overrides), 'Project variable overrides must be a named object')
  unique(definitions.map(variable => variable.name), 'declared variable name')
  const declared = new Set(definitions.map(variable => variable.name))
  for (const name of Object.keys(overrides)) requireValue(declared.has(name), `Project variable ${name} must be declared before it can be configured`)
  const values = []
  const secretNames = new Set()
  for (const variable of definitions) {
    const value = Object.hasOwn(overrides, variable.name) ? overrides[variable.name] : variable.default
    if (variable.secret) {
      secretNames.add(variable.name)
      requireValue(value === undefined || value === null || value === '', `Secret variable ${variable.name} must come from the backend workspace vault; remove its value before saving to Git`)
      continue
    }
    if (variable.required) requireValue(value !== undefined && value !== null && value !== '', `Required project variable ${variable.name} needs a value`)
    if (value === undefined || value === null) continue
    validateVariableName(variable.name)
    values.push([variable.name, value])
  }
  return { values: Object.fromEntries(values), secretNames }
}

/** Seed explicit authoring values; never guess VMIDs or source template IDs. */
export function createScenarioDraft(project, nodes = [], edges = []) {
  const saved = project.scenario ? JSON.parse(JSON.stringify(project.scenario)) : null
  const label = String(project.name || 'scenario').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'scenario'
  const networks = nodes.filter(node => node.type === 'network-segment').map((node, index) => ({
    id: node.id, vnet: nodeConfig(node).vnet || `r42net${index + 1}`,
    subnet: nodeConfig(node).cidr || '', gateway: nodeConfig(node).gateway || '', snat: true,
  }))
  const draft = {
    label, network_mode: 'sdn', zone: 'r42lab', networks,
    vms: nodes.filter(node => node.type === 'vm').map(node => {
      const edge = edges.find(edge => (edge.source === node.id && networks.some(n => n.id === edge.target))
        || (edge.target === node.id && networks.some(n => n.id === edge.source)))
      const config = nodeConfig(node)
      return { node_id: node.id, vm_id: node.data?.vmId || config.vmid || '',
        vm_name: config.name || node.data?.label || node.id, template_vm_id: config.template || '',
        network_id: edge ? (edge.source === node.id ? edge.target : edge.source) : '',
        ip: String(edge?.data?.connection?.ipAddress || config.ipAddress || '').split('/')[0], ssh_user: 'alice' }
    }),
    content: [],
  }
  const result = saved ? { ...saved,
    networks: draft.networks.map(network => saved.networks?.find(old => old.id === network.id) || network),
  } : draft
  result.vms = draft.vms.map(vm => {
    const previous = saved?.vms?.find(old => old.node_id === vm.node_id)
    const configured = previous || vm
    const oldNics = configured.nics || [{ network_id: configured.network_id, ip: configured.ip }]
    const connected = edges.filter(edge => edge.source === vm.node_id || edge.target === vm.node_id)
      .map(edge => ({ edge, id: edge.source === vm.node_id ? edge.target : edge.source }))
      .filter(connection => networks.some(network => network.id === connection.id))
    // Keep the management connection first if the canvas reorders its edges.
    connected.sort((a, b) => Number(b.id === oldNics[0]?.network_id) - Number(a.id === oldNics[0]?.network_id))
    const remaining = [...oldNics]
    const nics = connected.map(({ edge, id }) => {
      const index = remaining.findIndex(nic => nic.network_id === id)
      const old = index >= 0 ? remaining.splice(index, 1)[0] : null
      return { network_id: id, ip: old?.ip || String(edge.data?.connection?.ipAddress || '').split('/')[0] }
    })
    if (!nics.length) nics.push({ network_id: '', ip: configured.ip || '' })
    return { ...vm, ...previous, nics, network_id: nics[0].network_id, ip: nics[0].ip }
  })
  return result
}

function teardownPlay(vms) {
  const read = (path, result) => ({
    'ansible.builtin.uri': { url: `https://{{ proxmox_api_host }}/api2/json/${path}`, method: 'GET',
      headers: { Authorization: 'PVEAPIToken={{ proxmox_api_user }}!{{ proxmox_api_token_id }}={{ proxmox_api_token_secret }}' },
      validate_certs: '{{ proxmox_api_validate_certs | default(true) }}' },
    register: result, no_log: true, changed_when: false,
  })
  return [{ name: 'Remove only VMs owned by this deployment', hosts: 'proxmox', gather_facts: false,
    vars_files: [VAULT], tasks: [
      { name: 'Find remaining VM resources', ...read('cluster/resources?type=vm', 'r42_teardown_resources') },
      ...vms.map(vm => ({ name: `Remove ${vm.vm_name} (${vm.vm_id}) if it still exists`,
        when: `r42_teardown_resources.json.data | selectattr('vmid', 'equalto', ${Number(vm.vm_id)}) | list | length > 0`,
        block: [
          { name: 'Verify resource type and node', 'ansible.builtin.assert': { that: [
            `(r42_teardown_resources.json.data | selectattr('vmid', 'equalto', ${Number(vm.vm_id)}) | first).type == 'qemu'`,
            `(r42_teardown_resources.json.data | selectattr('vmid', 'equalto', ${Number(vm.vm_id)}) | first).node == proxmox_node`,
          ], fail_msg: 'VM type or node no longer matches this deployment; refusing removal' } },
          { name: 'Read VM ownership before any mutation', ...read(`nodes/{{ proxmox_node }}/qemu/${Number(vm.vm_id)}/config`, 'r42_teardown_config') },
          { name: 'Verify exact deployment ownership', 'ansible.builtin.assert': { that: [
            "r42_deployment_id | default('') | length > 0",
            `r42_teardown_config.json.data.name | default('') == '${vm.vm_name}'`,
            "r42_teardown_config.json.data.template | default(0) | int == 0",
            "('range42-deployment:' ~ r42_deployment_id) in (r42_teardown_config.json.data.description | default('')).splitlines()",
          ], fail_msg: 'VM ownership does not match this deployment; refusing shutdown and removal' } },
          { name: 'Read current VM status', ...read(`nodes/{{ proxmox_node }}/qemu/${Number(vm.vm_id)}/status/current`, 'r42_teardown_status') },
          { name: 'Request graceful VM shutdown', 'ansible.builtin.include_role': { name: 'range42-ansible_roles-proxmox_controller' },
            vars: { proxmox_vm_action: 'vm_stop', vm_id: Number(vm.vm_id), vm_name: vm.vm_name },
            when: "r42_teardown_status.json.data.status != 'stopped'" },
          { name: 'Wait until VM shutdown completes', ...read(`nodes/{{ proxmox_node }}/qemu/${Number(vm.vm_id)}/status/current`, 'r42_teardown_stopped'),
            until: "r42_teardown_stopped.json.data.status | default('') == 'stopped'", retries: 60, delay: 2 },
          { name: 'Remove stopped deployment VM', 'ansible.builtin.include_role': { name: 'range42-ansible_roles-proxmox_controller' },
            vars: { proxmox_vm_action: 'vm_delete', vm_id: Number(vm.vm_id), vm_name: vm.vm_name } },
          { name: 'Verify deletion started', 'ansible.builtin.assert': { that: ["(vm_delete.raw_data.data | default('')).startswith('UPID:')"],
            fail_msg: 'VM removal did not return a task identifier' } },
          { name: 'Wait for the VM deletion task', ...read("nodes/{{ vm_delete.raw_data.data.split(':')[1] }}/tasks/{{ vm_delete.raw_data.data }}/status", 'r42_teardown_deleted'),
            until: "r42_teardown_deleted.json.data.status | default('') == 'stopped'", retries: 60, delay: 2 },
          { name: 'Verify VM deletion succeeded', 'ansible.builtin.assert': { that: ["r42_teardown_deleted.json.data.exitstatus | default('') == 'OK'"],
            fail_msg: 'VM removal task failed; inspect its Proxmox task log before retrying' } },
        ],
      })),
    ],
  }]
}

/** Compile one explicitly configured canvas into the existing concrete runner contract. */
export function emitConcreteScenario({ scenario, nodes = [], edges = [], files = {}, attachments = [], generatedPaths = [], baseDoc, overlay }) {
  validateFileMap(files)
  requireValue(scenario && /^[a-z][a-z0-9_]{0,47}$/.test(scenario.label), 'Scenario name must start with a lowercase letter and contain only letters, numbers and underscores (48 characters maximum)')
  requireValue(['sdn', 'existing_bridge'].includes(scenario.network_mode), 'Choose SDN or an existing bridge network')
  requireValue(!attachments.length, 'Existing canvas attachments must be moved into the scenario Content list before generating; they cannot be silently omitted')
  const projectVariables = configurationVariables(baseDoc, overlay)
  for (const node of nodes) {
    requireValue(['vm', 'network-segment', 'group'].includes(node.type), `Unsupported canvas kind: ${node.type}; this scenario supports VMs and networks`)
    requireValue(node.data?.kind !== 'team_scope' && node.data?.replication?.scope !== 'per_team' && node.replication?.scope !== 'per_team', 'Replicated teams require explicit VM and network instances; automatic replication is not supported by this emitter')
  }
  const vms = normalizedVms(scenario.vms || [])
  const networks = scenario.networks || []
  requireValue(vms.length > 0, 'Add at least one VM to the canvas and configure it')
  requireValue(networks.length > 0, 'Add a network to the canvas and connect every VM')
  const nodeVms = nodes.filter(node => node.type === 'vm').map(node => node.id).sort()
  const nodeNetworks = nodes.filter(node => node.type === 'network-segment').map(node => node.id).sort()
  requireValue(JSON.stringify(vms.map(vm => vm.node_id).sort()) === JSON.stringify(nodeVms), 'VM configuration no longer matches the canvas; reopen scenario configuration')
  requireValue(JSON.stringify(networks.map(network => network.id).sort()) === JSON.stringify(nodeNetworks), 'Network configuration no longer matches the canvas; reopen scenario configuration')
  unique(vms.map(vm => Number(vm.vm_id)), 'VMID')
  unique(vms.map(vm => vm.vm_name), 'VM name')
  unique(networks.map(network => network.vnet), 'network name')
  unique(vms.flatMap(vm => vm.nics.map(nic => nic.ip)), 'VM NIC IP address')
  if (scenario.network_mode === 'sdn') requireValue(/^[a-z][a-z0-9]{0,7}$/.test(scenario.zone), 'SDN zone must contain 1–8 lowercase letters or numbers and start with a letter')
  const ranges = new Map()
  for (const network of networks) {
    requireValue((scenario.network_mode === 'sdn' ? /^[a-z][a-z0-9]{0,7}$/ : /^vmbr[0-9]+$/).test(network.vnet), `Invalid ${scenario.network_mode === 'sdn' ? 'SDN VNet' : 'existing bridge'} name: ${network.vnet}`)
    const range = subnet(network.subnet)
    const gateway = address(network.gateway, 'gateway')
    requireValue(gateway > range.start && gateway < range.end, `Gateway must be a usable host in subnet ${network.subnet}`)
    requireValue(typeof network.snat === 'boolean', 'Choose whether each subnet has outbound NAT')
    for (const other of ranges.values()) requireValue(range.end < other.start || range.start > other.end, 'Network subnets overlap')
    ranges.set(network.id, range)
  }
  const allVmIds = new Set(vms.map(vm => Number(vm.vm_id)))
  for (const vm of vms) {
    requireValue(Number.isInteger(Number(vm.vm_id)) && Number(vm.vm_id) >= 100 && Number(vm.vm_id) <= 999999999, `VMID must be an integer from 100 to 999999999: ${vm.vm_name}`)
    requireValue(Number.isInteger(Number(vm.template_vm_id)) && Number(vm.template_vm_id) >= 100 && Number(vm.template_vm_id) <= 999999999 && !allVmIds.has(Number(vm.template_vm_id)), `Choose an existing template VMID distinct from every target VM: ${vm.vm_name}`)
    requireValue(/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(vm.vm_name) && !['all', 'ungrouped', 'localhost', 'proxmox', 'proxmox_cli', 'scenario_guests', 'r42-proxmox', 'r42-proxmox-cli'].includes(vm.vm_name), `Invalid or reserved VM name: ${vm.vm_name}`)
    requireValue(/^[a-z_][a-z0-9_-]{0,31}$/.test(vm.ssh_user), `Invalid SSH username for ${vm.vm_name}`)
    const connections = edges.filter(edge => edge.source === vm.node_id || edge.target === vm.node_id)
    const connected = connections.map(edge => edge.source === vm.node_id ? edge.target : edge.source).sort()
    requireValue(connections.every(edge => edge.source !== edge.target)
      && JSON.stringify(connected) === JSON.stringify(vm.nics.map(nic => nic.network_id).sort()),
    `VM ${vm.vm_name} NICs must match every connected canvas network`)
    for (const nic of vm.nics) {
      const network = networks.find(network => network.id === nic.network_id)
      requireValue(network, `Select a network for ${vm.vm_name}`)
      const range = ranges.get(network.id)
      const ip = address(nic.ip, `NIC address for ${vm.vm_name}`)
      requireValue(ip > range.start && ip < range.end, `VM ${vm.vm_name} must have a usable address in subnet ${network.subnet}`)
      requireValue(nic.ip !== network.gateway, `VM ${vm.vm_name} cannot use its gateway address`)
    }
  }
  requireValue(edges.every(edge => vms.some(vm => vm.node_id === edge.source || vm.node_id === edge.target)), 'Unsupported network-to-network connection on the canvas')

  const base = `scenarios/${scenario.label}`
  const generated = {}
  const write = (path, value, format = yaml) => { generated[`${base}/${path}`] = format(value) }
  const networkManifest = scenario.network_mode === 'sdn'
    ? { mode: 'sdn', zone: scenario.zone, vnets: networks.map(({ vnet, subnet, gateway, snat }) => ({ vnet, subnet, gateway, snat })) }
    : { mode: 'existing_bridge', bridges: networks.map(network => network.vnet) }
  write('manifest/scenario_networks.json', networkManifest, json)
  write('manifest/scenario_vms.json', { scenario: scenario.label, version: 3,
    vms: vms.map(vm => ({ vm_id: Number(vm.vm_id), vm_name: vm.vm_name, ip: vm.ip, role: 'vm',
      bridge: networks.find(network => network.id === vm.network_id).vnet, template_vm_id: Number(vm.template_vm_id),
      nics: vm.nics.map((nic, index) => ({ index, ip: nic.ip,
        bridge: networks.find(network => network.id === nic.network_id).vnet,
        prefix: Number(ranges.get(nic.network_id).prefix),
        ...(index === 0 ? { gateway: networks.find(network => network.id === nic.network_id).gateway } : {}),
      })),
      ...Object.fromEntries(['cores', 'memory_mb', 'disk_gb', 'disk_device'].filter(key => vm[key] !== undefined && (key !== 'disk_device' || vm.disk_gb !== undefined)).map(key => [key, vm[key]])),
    })),
    templates: [...new Set(vms.map(vm => Number(vm.template_vm_id)))].map(vm_id => ({ vm_id })),
  }, json)
  write('hosts.yml', { all: { children: {
    proxmox: { hosts: { 'r42-proxmox': { ansible_connection: 'local', ansible_python_interpreter: '{{ ansible_playbook_python }}' } } },
    proxmox_cli: { hosts: { 'r42-proxmox-cli': { ansible_host: '{{ r42_proxmox_address }}', ansible_user: '{{ r42_proxmox_ssh_user }}',
      ansible_ssh_common_args: HOST_KEY_OPTIONS } } },
    scenario_guests: { hosts: Object.fromEntries(vms.map(vm => [vm.vm_name, {
      ansible_host: vm.ip, ansible_user: vm.ssh_user,
      ansible_ssh_common_args: `${PROXY_OPTIONS} ${HOST_KEY_OPTIONS}`,
    }])) },
  } } })
  if (scenario.network_mode === 'sdn') write('00_networks.yml', [imported(`${BUNDLES}/proxmox/sdn_network.bootstrap/main.yml`, {
    BUNDLE_SDN_ZONE: scenario.zone, BUNDLE_SDN_VNETS: networkManifest.vnets,
  })])
  write('01_vm_bootstrap.yml', vms.map(vm => {
    const network = networks.find(network => network.id === vm.network_id)
    const extra = Object.fromEntries(vm.nics.slice(1).flatMap((nic, offset) => {
      const index = offset + 1
      const network = networks.find(network => network.id === nic.network_id)
      return [[`net${index}`, `virtio,bridge=${network.vnet}`], [`ipconfig${index}`, `ip=${nic.ip}/${ranges.get(network.id).prefix}`]]
    }))
    if (vm.cores !== undefined) extra.cores = vm.cores
    if (vm.memory_mb !== undefined) extra.memory = vm.memory_mb
    return imported(`${BUNDLES}/proxmox/vm.bootstrap/main.yml`, {
      global_vm_ssh_name: vm.vm_name, global_vm_name: vm.vm_name, global_vm_id: Number(vm.vm_id),
      global_vm_description: 'range42-deployment:{{ r42_deployment_id }}',
      global_vm_tag_name: scenario.label.replace(/_/g, '-'), global_vm_ci_ip: vm.ip,
      global_template_vm_id: Number(vm.template_vm_id), global_vm_net_virtio_bridge: network.vnet,
      global_vm_ci_ip_gw: network.gateway, global_vm_ci_netmask: ranges.get(network.id).prefix,
      default_admin_vm_ci_user: vm.ssh_user,
      ...(Object.keys(extra).length ? { global_vm_extra_config: extra } : {}),
      ...(vm.disk_gb !== undefined ? { global_vm_disk: { disk: vm.disk_device, size_gb: vm.disk_gb } } : {}),
    })
  }))
  const configure = []
  const bundleAttachments = []
  const content = scenario.content || []
  unique(content.map(item => item.id), 'content identifier')
  for (const item of content) {
    const vm = vms.find(vm => vm.node_id === item.target_node)
    requireValue(vm, `Select a VM for content ${item.id}`)
    safePath(item.path)
    requireValue(!item.vars || (typeof item.vars === 'object' && !Array.isArray(item.vars)), `Content variables must be a named object: ${item.id}`)
    if (item.kind === 'bundle') {
      const resolution = item.resolution
      const singleVmScope = resolution?.bundle_kind === 'VM' || (resolution?.bundle_kind === 'GROUP' && resolution.target_kind === 'VM'
        && Array.isArray(resolution.target_vars) && resolution.target_vars.includes('target_group'))
      requireValue(singleVmScope && resolution.proof_kind === 'content_match'
        && resolution.entrypoint === item.path && resolution.path === `bundles/${item.path.replace(/\/main\.yml$/, '')}`
        && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(resolution.source_sha || '')
        && resolution.runtime?.fingerprint && resolution.runtime?.proof && Array.isArray(resolution.target_vars),
      'Resolve this bundle from the library to obtain verified source and runtime provenance')
      requireValue(item.path.endsWith('/main.yml'), 'Bundle path must end in /main.yml')
      const targetValues = { global_vm_ssh_name: vm.vm_name, target_ansible_host: vm.vm_name, global_vm_ci_ip: vm.ip, target_group: vm.vm_name }
      requireValue(resolution.target_vars.every(name => Object.hasOwn(targetValues, name)), 'Bundle target parameters are not supported by this scenario')
      validateBundleParameters(resolution.params, item.vars || {}, resolution.target_vars)
      requireValue(!bundleAttachments.some(attachment => attachment.vm_id === Number(vm.vm_id) && attachment.resolution.path === resolution.path), 'Duplicate bundle attachment for the same VM')
      const parameters = item.vars || {}
      bundleAttachments.push({ vm_id: Number(vm.vm_id), inventory_host: vm.vm_name, resolution, parameters })
      configure.push(imported(`${BUNDLES}/${item.path}`, { ...parameters,
        ...Object.fromEntries(resolution.target_vars.map(name => [name, targetValues[name]])),
      }))
      continue
    }
    for (const name of Object.keys(item.vars || {})) {
      requireValue(!projectVariables.secretNames.has(name), `Secret variable ${name} must come from the backend workspace vault`)
      validateVariableName(name)
    }
    const vars = { ...projectVariables.values, ...(item.vars || {}), global_vm_ssh_name: vm.vm_name, global_vm_ci_ip: vm.ip }
    requireValue(Object.hasOwn(files, `${base}/${item.path}`), `Content file is missing: ${base}/${item.path}`)
    requireValue(item.kind === 'file' || typeof files[`${base}/${item.path}`] === 'string', `${item.kind} content must be text: ${item.path}`)
    if (item.kind === 'playbook') {
      const plays = parse(files[`${base}/${item.path}`])
      requireValue(Array.isArray(plays) && plays.length > 0 && plays.every(play => play && ['{{ global_vm_ssh_name }}', vm.vm_name].includes(play.hosts)), `Playbook ${item.path} must contain plays with hosts: "{{ global_vm_ssh_name }}" (or ${vm.vm_name})`)
      configure.push(imported(item.path, vars))
    } else {
      requireValue(['file', 'script'].includes(item.kind), `Unsupported content kind: ${item.kind}`)
      let task
      if (item.kind === 'file') {
        requireValue(typeof item.destination === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(item.destination) && item.destination.split('/').every(part => part !== '..' && part !== '.'), `File destination must be an absolute guest path: ${item.id}`)
        requireValue(/^0[0-7]{3}$/.test(item.mode || '0644'), `Invalid file mode: ${item.id}`)
        task = { name: `Copy ${item.path}`, 'ansible.builtin.copy': { src: `{{ playbook_dir }}/${item.path}`, dest: item.destination, mode: item.mode || '0644' } }
      } else task = { name: `Run ${item.path}`, 'ansible.builtin.script': { cmd: `{{ playbook_dir }}/${item.path}` } }
      configure.push({ name: `${item.kind}: ${item.path}`, hosts: vm.vm_name, gather_facts: false, become: true, vars_files: [VAULT], vars, tasks: [task] })
    }
  }
  write('configure.yml', configure.length ? configure : [{ name: 'No additional guest content configured', hosts: 'scenario_guests', gather_facts: false, tasks: [] }])
  if (bundleAttachments.length) write('manifest/scenario_bundles.json', { version: 1, attachments: bundleAttachments }, json)
  write('main.yml', [
    ...(scenario.network_mode === 'sdn' ? [imported('00_networks.yml')] : []),
    imported('01_vm_bootstrap.yml'), imported('configure.yml'),
  ])
  write('teardown.yml', teardownPlay(vms))
  for (const item of content) {
    requireValue(item.kind === 'bundle' || !Object.hasOwn(generated, `${base}/${item.path}`),
      `Content path is reserved for generated scenario files: ${item.path}; use a path inside content/`)
  }
  const nextFiles = { ...files }
  for (const path of generatedPaths) delete nextFiles[path]
  for (const [path, value] of Object.entries(generated)) {
    requireValue(!(path in nextFiles) || nextFiles[path] === value, `Generated path already exists: ${path}; choose a new scenario name or review ownership of the existing scenario`)
    nextFiles[path] = value
  }
  return { files: nextFiles, generatedPaths: Object.keys(generated), scenario: JSON.parse(JSON.stringify({ ...scenario, vms })) }
}

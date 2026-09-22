/** Native controller adapter for literal NIC networks and deployment-owned guests. */
const VAULT = "{{ lookup('env', 'RANGE42_ACTIVE_CONFIG_DIR') }}/secrets/default_vault.yml"
const ROLE = 'range42-ansible_roles-proxmox_controller'
const PREFIX = "{{ lookup('env', 'RANGE42_BUNDLE_DIR') }}/firewall/in_proxmox/"
const imported = name => ({ 'ansible.builtin.import_playbook': `${PREFIX}${name}/main.yml` })
const arming = "FIREWALL_ARM_VMS | default('NO') | upper == 'YES'"

export function firewallPolicy(settings) {
  if (settings == null) return null
  if (typeof settings !== 'object' || Array.isArray(settings) || typeof settings.enabled !== 'boolean'
    || ['prepare_management_access', 'arm_vms'].some(key => settings[key] !== undefined && typeof settings[key] !== 'boolean')) {
    throw new Error('Firewall choices must use explicit Boolean values')
  }
  if (!settings.enabled) return null
  const mode = settings.ssh_mode || 'inherit'
  let sources = mode === 'inherit' ? null : []
  if (!['inherit', 'restricted', 'unrestricted'].includes(mode)) throw new Error('Choose how to configure guest SSH sources')
  if (mode === 'restricted') {
    sources = typeof settings.ssh_sources === 'string' ? settings.ssh_sources.trim().split(/[\s,]+/) : []
    if (!sources.length || sources.length > 64 || new Set(sources).size !== sources.length || sources.some(source => {
      if (!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/32$/.test(source)) return true
      return source.slice(0, -3).split('.').some(part => String(Number(part)) !== part || Number(part) > 255)
    })) throw new Error('SSH sources must be up to 64 distinct IPv4 /32 addresses')
  }
  return { version: 1, prepare_management_access: settings.prepare_management_access === true,
    arm_vms: settings.arm_vms === true, ssh_sources: sources }
}

function ownershipTasks(vms) {
  return vms.flatMap(vm => [
    { name: `Read ownership of guest ${vm.vm_id}`, 'ansible.builtin.uri': {
      url: `https://{{ proxmox_api_host }}/api2/json/nodes/{{ proxmox_node }}/qemu/${Number(vm.vm_id)}/config`, method: 'GET',
      headers: { Authorization: 'PVEAPIToken={{ proxmox_api_user }}!{{ proxmox_api_token_id }}={{ proxmox_api_token_secret }}' },
      validate_certs: true, ca_path: "{{ lookup('env', 'RANGE42_PROXMOX_CA_FILE') | default(omit, true) }}",
    }, register: 'r42_fw_owned_config', no_log: true },
    { name: `Require exact deployment ownership of guest ${vm.vm_id}`, 'ansible.builtin.assert': { that: [
      "r42_deployment_id | default('') | length > 0",
      `r42_fw_owned_config.json.data.name | default('') == '${vm.vm_name}'`,
      "not (r42_fw_owned_config.json.data.template | default(false) | bool)",
      "('range42-deployment:' ~ r42_deployment_id) in (r42_fw_owned_config.json.data.description | default('')).splitlines()",
    ], fail_msg: 'Guest ownership changed; no firewall mutation is allowed' }, no_log: true },
  ])
}

export function firewallStages(vms, networks) {
  const sources = { name: 'Resolve guest SSH sources from the reviewed policy or native workspace vault',
    'ansible.builtin.set_fact': { r42_fw_sources: '{{ range42_fw_vm_ssh_sources | default([]) }}' } }
  const validateSources = { name: 'Validate inherited or reviewed guest SSH sources', 'ansible.builtin.assert': { that: [
    'r42_fw_sources is not string', 'r42_fw_sources is not mapping', 'r42_fw_sources is sequence',
    '(r42_fw_sources | length) <= 64',
    "(r42_fw_sources | reject('match', '^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/32$') | list | length) == 0",
  ], fail_msg: 'Guest SSH sources must be a bounded list of IPv4 /32 addresses' } }
  const sourceExpression = "{{ (r42_fw_scenario_networks + (r42_fw_sources | map('regex_replace', '/32$', '') | list)) | unique | join(',') }}"
  const declare = restricted => ({ name: `Declare SSH on owned scenario guests (${restricted ? 'restricted' : 'unrestricted'})`,
    'ansible.builtin.include_role': { name: ROLE }, vars: {
      proxmox_vm_action: 'firewall_vm_declare_iptables_port', vm_id: '{{ r42_fw_guest_id }}', vm_fw_dport: '22',
      vm_fw_comment: 'range42 baseline ssh, scenario-wide', ...(restricted ? { vm_fw_source: sourceExpression } : {}),
    }, loop: vms.map(vm => Number(vm.vm_id)), loop_control: { loop_var: 'r42_fw_guest_id' },
    when: `(r42_fw_sources | length) ${restricted ? '>' : '=='} 0`,
  })
  const play = tasks => ({ hosts: 'proxmox', gather_facts: false, vars_files: [VAULT], tasks })
  const guard = { name: 'Require backend-verified native firewall preferences', 'ansible.builtin.assert': {
    that: ["r42_fw_contract | default('') == 'native-sdn-20260921'"], fail_msg: 'Run this generated scenario through its backend deployment with verified firewall preferences',
  } }
  return {
    '00_firewall_pre.yml': [play([guard, sources, validateSources]), imported('firewall.report.status'),
      { ...imported('firewall.baseline.management_access'), when: 'r42_fw_prepare_management_access | default(false) | bool' }],
    '02_firewall_guests.yml': [{ ...play([guard, ...ownershipTasks(vms), sources, validateSources, declare(false), declare(true)]),
      vars: { r42_fw_scenario_networks: [...new Set(networks.map(network => network.subnet))] } }],
    '99_firewall_finalize.yml': [
      play([guard, ...ownershipTasks(vms), sources, validateSources].map(task => ({ ...task, when: arming }))),
      { ...imported('firewall.enable.vms'), when: [arming, '(r42_fw_sources | length) == 0'] },
      { ...imported('firewall.enable.vms'), vars: { vm_fw_mgmt_source: sourceExpression }, when: [arming, '(r42_fw_sources | length) > 0'] },
      imported('firewall.report.status'),
    ],
  }
}

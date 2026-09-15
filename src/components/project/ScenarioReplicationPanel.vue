<script setup>
import { computed, ref } from 'vue'
import { randomId } from '@/services/randomId'
import { planScenarioReplication } from '@/services/scenarioReplication'

const props = defineProps({
  modelValue: { type: Object, default: undefined }, scenario: { type: Object, required: true },
  projectId: { type: String, required: true }, nodes: { type: Array, required: true }, edges: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])
const cached = ref(null)
const copy = value => JSON.parse(JSON.stringify(value))
const scopes = [['shared', 'Shared — one instance'], ['per_team', 'Per team'], ['per_user', 'Per user within each team']]
const totalUsers = computed(() => props.modelValue?.teams.reduce((sum, team) => sum + team.users.length, 0) || 0)
const planned = computed(() => {
  if (!props.modelValue) return { value: null, error: '' }
  try { return { value: planScenarioReplication({ scenario: { ...props.scenario, replication: props.modelValue }, nodes: props.nodes, edges: props.edges }), error: '' } }
  catch (error) { return { value: null, error: error.message || String(error) } }
})
const vmRows = computed(() => planned.value.value?.instances.filter(vm => props.modelValue.node_scopes[vm.source_node_id] !== 'shared') || [])
const networkRows = computed(() => planned.value.value?.network_instances.filter(network => props.modelValue.network_scopes[network.source_node_id] !== 'shared') || [])
function hint(id) {
  const visited = new Set()
  let node = props.nodes.find(node => node.id === id)
  while (node && !visited.has(node.id)) {
    visited.add(node.id)
    const scope = node.data?.replication?.scope ?? node.replication?.scope
    if (scope) return scope
    if (node.data?.kind === 'team_scope') return 'per_team'
    node = props.nodes.find(parent => parent.id === (node.parentNode || node.parent))
  }
  return 'shared'
}
function scopeChanges(ids, saved = {}) {
  const current = new Set(ids)
  return {
    added: ids.filter(id => !Object.hasOwn(saved, id)).map(id => ({ id, scope: hint(id) })),
    removed: Object.keys(saved).filter(id => !current.has(id)),
  }
}
const sourceChanges = computed(() => {
  const vms = scopeChanges(props.scenario.vms.map(vm => vm.node_id), props.modelValue?.node_scopes)
  const networks = scopeChanges(props.scenario.networks.map(network => network.id), props.modelValue?.network_scopes)
  return { vms, networks, pending: [vms, networks].some(change => change.added.length || change.removed.length) }
})
function reconcileSources() {
  update(next => {
    for (const [field, changes] of [['node_scopes', sourceChanges.value.vms], ['network_scopes', sourceChanges.value.networks]]) {
      next[field] = Object.fromEntries([
        ...Object.entries(next[field] || {}).filter(([id]) => !changes.removed.includes(id)),
        ...changes.added.map(({ id, scope }) => [id, scope]),
      ])
    }
  })
}
function enable(event) {
  if (!event.target.checked) {
    cached.value = copy(props.modelValue)
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', prepare(cached.value ? copy(cached.value) : {
    version: 1, scenario_id: props.projectId, teams: [],
    node_scopes: Object.fromEntries(props.scenario.vms.map(vm => [vm.node_id, hint(vm.node_id)])),
    network_scopes: Object.fromEntries(props.scenario.networks.map(network => [network.id, hint(network.id)])),
    vm_assignments: {}, network_assignments: {},
  }))
}
function update(change) {
  const next = copy(props.modelValue)
  change(next)
  emit('update:modelValue', prepare(next))
}
function addTeam() { update(next => next.teams.push({ id: `team-${randomId()}`, label: `Team ${next.teams.length + 1}`, users: [] })) }
function addUser(teamId) {
  update(next => {
    const team = next.teams.find(team => team.id === teamId)
    team.users.push({ id: `user-${randomId()}`, label: `User ${team.users.length + 1}` })
  })
}
function cohort(row) {
  const team = props.modelValue.teams.find(team => team.id === row.team_id)
  const user = team?.users.find(user => user.id === row.user_id)
  return [row.source_node_id, team?.label || team?.id, user?.label || user?.id].filter(Boolean).join(' · ')
}
function setNetwork(key, field, value) { update(next => { next.network_assignments[key][field] = value }) }
function setVm(key, value) { update(next => { next.vm_assignments[key].vm_id = value === '' ? '' : Number(value) }) }
function setIp(key, nicKey, value) { update(next => { next.vm_assignments[key].nics[nicKey] = { ip: value } }) }
function removeObsoleteNics() {
  update(next => {
    for (const row of vmRows.value) {
      const allowed = new Set(row.nics.map(nic => nic.nic_key))
      next.vm_assignments[row.instance_key].nics = Object.fromEntries(Object.entries(next.vm_assignments[row.instance_key].nics).filter(([key]) => allowed.has(key)))
    }
  })
}
const obsoleteNics = computed(() => vmRows.value.some(row => Object.keys(props.modelValue.vm_assignments[row.instance_key]?.nics || {}).some(key => !row.nics.some(nic => nic.nic_key === key))))

// Complete newly introduced rows in the same edit transaction. Do not emit
// from a computed watcher: parent prop updates can otherwise form a cycle.
function prepare(next) {
  let plan
  try { plan = planScenarioReplication({ scenario: { ...props.scenario, replication: next }, nodes: props.nodes, edges: props.edges }) }
  catch { return next }
  if (!plan) return next
  for (const row of plan.network_instances.filter(row => next.network_scopes[row.source_node_id] !== 'shared')) if (!next.network_assignments[row.instance_key]) {
    const network = plan.networks.find(network => network.id === row.instance_key)
    next.network_assignments[row.instance_key] = { vnet: network.vnet, subnet: '', gateway: '', snat: network.snat }
  }
  for (const row of plan.instances.filter(row => next.node_scopes[row.source_node_id] !== 'shared')) {
    next.vm_assignments[row.instance_key] ||= { vm_id: '', nics: {} }
    for (const nic of row.nics) next.vm_assignments[row.instance_key].nics[nic.nic_key] ||= { ip: '' }
  }
  return next
}
</script>

<template>
  <section class="border border-base-300 rounded-lg p-3 sm:p-4 mb-5 space-y-4 min-w-0" aria-labelledby="replication-title">
    <h3 id="replication-title" class="font-semibold">Teams and users</h3>
    <label class="flex gap-2 items-center"><input type="checkbox" class="checkbox checkbox-sm" data-testid="replication-enable" :checked="!!modelValue" @change="enable" /> Replicate this scenario from an explicit roster</label>
    <template v-if="modelValue">
      <p class="text-sm">Choose an executable scope for every source VM and network. These reviewed scopes take precedence over canvas hints. Stable IDs keep assignments when labels or roster order change.</p>
      <p class="text-xs break-all">Scenario identity: <span class="font-mono">{{ modelValue.scenario_id }}</span></p>
      <div v-for="team in modelValue.teams" :key="team.id" class="border border-base-300 rounded-lg p-3 space-y-3 min-w-0" data-testid="replication-team">
        <div class="flex flex-wrap items-end gap-2">
          <label class="form-control gap-1 flex-1 min-w-0"><span>Team label</span><input class="input input-bordered input-sm w-full" :value="team.label" maxlength="256" @input="update(next => { next.teams.find(row => row.id === team.id).label = $event.target.value })" /></label>
          <button type="button" class="btn btn-ghost btn-sm" @click="update(next => { next.teams = next.teams.filter(row => row.id !== team.id) })">Remove team</button>
        </div>
        <p class="text-xs font-mono break-all">{{ team.id }}</p>
        <div v-for="user in team.users" :key="user.id" class="flex flex-wrap gap-2 items-end min-w-0" data-testid="replication-user">
          <label class="form-control gap-1 flex-1 min-w-0"><span>User label</span><input class="input input-bordered input-sm w-full" :value="user.label" maxlength="256" @input="update(next => { next.teams.find(row => row.id === team.id).users.find(row => row.id === user.id).label = $event.target.value })" /><span class="text-xs font-mono break-all">{{ user.id }}</span></label>
          <button type="button" class="btn btn-ghost btn-sm" @click="update(next => { const row = next.teams.find(row => row.id === team.id); row.users = row.users.filter(row => row.id !== user.id) })">Remove user</button>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-testid="replication-add-user" :disabled="totalUsers >= 64" @click="addUser(team.id)">Add user</button>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-testid="replication-add-team" :disabled="modelValue.teams.length >= 64" @click="addTeam">Add team</button>
      <p class="text-xs">Up to 64 teams and 64 users in total. Removing a roster entry changes the next generated plan; it does not remove an existing deployed VM or release any reservation.</p>
      <div class="grid sm:grid-cols-2 gap-3">
        <label v-for="vm in scenario.vms" :key="vm.node_id" class="form-control gap-1 min-w-0"><span class="break-words">VM scope: {{ vm.vm_name || vm.node_id }}</span><select class="select select-bordered w-full" :data-testid="`replication-vm-scope-${vm.node_id}`" :value="modelValue.node_scopes[vm.node_id]" @change="update(next => { next.node_scopes[vm.node_id] = $event.target.value })"><option v-for="[value, label] in scopes" :key="value" :value="value">{{ label }}</option></select></label>
        <label v-for="network in scenario.networks" :key="network.id" class="form-control gap-1 min-w-0"><span class="break-words">Network scope: {{ network.id }}</span><select class="select select-bordered w-full" :data-testid="`replication-network-scope-${network.id}`" :value="modelValue.network_scopes[network.id]" @change="update(next => { next.network_scopes[network.id] = $event.target.value })"><option v-for="[value, label] in scopes" :key="value" :value="value">{{ label }}</option></select></label>
      </div>
      <div v-if="sourceChanges.pending" class="border border-warning/50 bg-warning/10 rounded-lg p-3 space-y-2" data-testid="replication-source-review">
        <p class="font-semibold">Review changed canvas sources</p>
        <ul class="list-disc pl-5 space-y-1 break-words">
          <li v-for="source in sourceChanges.vms.added" :key="`add-vm-${source.id}`">Add VM {{ source.id }} with scope {{ source.scope }}.</li>
          <li v-for="id in sourceChanges.vms.removed" :key="`remove-vm-${id}`">Remove VM {{ id }} from the source scopes.</li>
          <li v-for="source in sourceChanges.networks.added" :key="`add-net-${source.id}`">Add network {{ source.id }} with scope {{ source.scope }}.</li>
          <li v-for="id in sourceChanges.networks.removed" :key="`remove-net-${id}`">Remove network {{ id }} from the source scopes.</li>
        </ul>
        <p class="text-sm">Existing scopes and saved instance assignments will be kept. New instances need reviewed assignments. Deployed resources and reservations are unaffected.</p>
        <button type="button" class="btn btn-outline btn-sm" data-testid="replication-reconcile-sources" @click="reconcileSources">Update source scopes</button>
      </div>
      <p v-if="planned.error" role="alert" class="alert alert-error break-words" data-testid="replication-error">{{ planned.error }}</p>
      <template v-if="planned.value">
        <p class="font-semibold" data-testid="replication-counts">{{ planned.value.counts.vms }} VMs · {{ planned.value.counts.networks }} networks · {{ planned.value.counts.nics }} NICs</p>
        <p class="text-sm">Define each instance network below, then reserve VM IDs and IP addresses for every generated VM in the allocation panel. You can also enter assignments manually. VNet names and subnets require your review; deployment preflight checks live conflicts.</p>
        <p v-for="warning in planned.value.warnings" :key="warning" class="text-sm rounded-lg border border-warning/50 bg-warning/10 p-3">{{ warning }}</p>
        <fieldset v-for="network in networkRows" :key="network.instance_key" class="border border-base-300 rounded-lg p-3 min-w-0" data-testid="replication-network-assignment">
          <legend class="text-sm px-1 break-words">Network: {{ cohort(network) }}</legend>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="form-control gap-1"><span>{{ scenario.network_mode === 'sdn' ? 'VNet name' : 'Existing bridge' }}</span><input class="input input-bordered w-full" data-testid="replication-vnet" :value="modelValue.network_assignments[network.instance_key]?.vnet || ''" :maxlength="scenario.network_mode === 'sdn' ? 8 : 15" @input="setNetwork(network.instance_key, 'vnet', $event.target.value)" /></label>
            <label class="form-control gap-1"><span>IPv4 subnet</span><input class="input input-bordered w-full" data-testid="replication-subnet" :value="modelValue.network_assignments[network.instance_key]?.subnet || ''" placeholder="10.42.20.0/24" @input="setNetwork(network.instance_key, 'subnet', $event.target.value)" /></label>
            <label class="form-control gap-1"><span>Gateway</span><input class="input input-bordered w-full" data-testid="replication-gateway" :value="modelValue.network_assignments[network.instance_key]?.gateway || ''" placeholder="10.42.20.1" @input="setNetwork(network.instance_key, 'gateway', $event.target.value)" /></label>
          </div>
          <label class="form-control gap-1 mt-3"><span>Reserved IP addresses</span><input class="input input-bordered w-full" data-testid="replication-reserved-ips" :value="(modelValue.network_assignments[network.instance_key]?.reserved_ips || []).join(', ')" maxlength="4096" placeholder="10.42.20.50, 10.42.20.51" @change="setNetwork(network.instance_key, 'reserved_ips', $event.target.value.split(/[\s,]+/).filter(Boolean))" /><span class="text-xs">Comma-separated addresses to exclude from VM allocation in this instance subnet.</span></label>
          <label v-if="scenario.network_mode === 'sdn'" class="flex items-center gap-2 mt-3"><input type="checkbox" class="checkbox checkbox-sm" :checked="modelValue.network_assignments[network.instance_key]?.snat" @change="setNetwork(network.instance_key, 'snat', $event.target.checked)" /> Outbound NAT for this subnet</label>
        </fieldset>
        <fieldset v-for="vm in vmRows" :key="vm.instance_key" class="border border-base-300 rounded-lg p-3 min-w-0" data-testid="replication-vm-assignment">
          <legend class="text-sm px-1 break-words">VM: {{ cohort(vm) }}</legend>
          <p class="text-xs font-mono break-all mb-3">{{ vm.hostname }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="form-control gap-1"><span>New VMID</span><input type="number" min="100" max="999999999" class="input input-bordered w-full" data-testid="replication-vmid" :value="modelValue.vm_assignments[vm.instance_key]?.vm_id ?? ''" @input="setVm(vm.instance_key, $event.target.value)" /></label>
            <label v-for="nic in vm.nics" :key="nic.nic_key" class="form-control gap-1 min-w-0"><span>net{{ nic.index }} IP{{ nic.index === 0 ? ' (management)' : '' }}</span><input class="input input-bordered w-full" data-testid="replication-ip" :value="modelValue.vm_assignments[vm.instance_key]?.nics[nic.nic_key]?.ip || ''" @input="setIp(vm.instance_key, nic.nic_key, $event.target.value)" /><span class="text-xs break-all">{{ nic.nic_key }} → {{ planned.value.networks.find(network => network.id === nic.network_instance_key)?.vnet }}</span></label>
          </div>
        </fieldset>
        <button v-if="obsoleteNics" type="button" class="btn btn-outline btn-sm" @click="removeObsoleteNics">Remove saved assignments for disconnected NICs</button>
      </template>
    </template>
  </section>
</template>

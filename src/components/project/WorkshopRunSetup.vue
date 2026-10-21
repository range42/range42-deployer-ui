<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { reserveScenarioAllocation, type ScenarioReservation } from '@/services/scenarioAllocation'
import type { NativeTopology } from '@/services/nativeScenarioCanvas'

export interface WorkshopSpec {
  namespace: string; seats: number; participants_per_environment?: number; expires_at: string; vmid_start: number;
  network_pool: string; bridge_start: number; proxmox_template: number; deployer_template: number;
  storage: string;
  managed_gateway?: {vm_id: number; management_bridge: string; management_subnet: string; management_ip: string};
}
export interface WorkshopSelection {
  workshop: WorkshopSpec; topology: NativeTopology;
  allocation: {backend_url: string; target_host_id: string; reservation: ScenarioReservation};
}
export interface ProvisioningProfile {
  id: string; vmid_ranges?: number[][]; networks?: Array<{bridge: string; subnet: string}>;
  proxmox_template?: number; deployer_template?: number; storage?: string;
  managed_gateway?: {management_bridge: string; management_subnet: string} | null;
}
const props = defineProps<{ projectId: string; revision: string; path: string; componentId?: string; targetHostId: string; minSeats: number; maxSeats: number; profile?: ProvisioningProfile | null }>()
const emit = defineEmits<{ select: [value: null | WorkshopSelection] }>()
const backend = useBackendApiStore()
const draftKey = `workshop-${crypto.randomUUID()}`
const fields = [
  {name: 'namespace', label: 'Run name', type: 'text', hint: 'Unique short name, such as training-october.'},
  {name: 'seats', label: 'Environments', type: 'number', hint: 'Each environment has one Proxmox VM and one CLI VM, shared by its group.'},
  {name: 'participants_per_environment', label: 'Participants per environment', type: 'number', hint: 'Roster capacity for each group. Individual login and laptop access are separate optional integrations.'},
  {name: 'expires_at', label: 'Workshop ends', type: 'datetime-local', hint: 'Your local time; saved in UTC.'},
  {name: 'vmid_start', label: 'First participant VMID', type: 'number', hint: 'Two consecutive VMIDs per environment. Existing allocations are protected.'},
  {name: 'network_pool', label: 'Participant network pool', type: 'text', hint: 'Private IPv4 CIDR, such as 10.79.0.0/24. One separate /28 per environment.'},
  {name: 'bridge_start', label: 'First participant bridge number', type: 'number', hint: 'For example, 600 uses vmbr600, vmbr601 and so on.'},
  {name: 'proxmox_template', label: 'Nested Proxmox template VMID', type: 'number', hint: 'Reusable qualified template; retained when the run is deleted.'},
  {name: 'deployer_template', label: 'Deployer template VMID', type: 'number', hint: 'Clean Linux template used for the native installation exercise.'},
  {name: 'storage', label: 'Participant VM storage', type: 'text', hint: 'Storage on the selected target for the cloned participant disks.'},
] as const
const input = reactive<Record<string, string | number>>({namespace: '', seats: Math.min(5, props.maxSeats), participants_per_environment: 1, expires_at: '',
  vmid_start: '', network_pool: '', bridge_start: '', proxmox_template: '', deployer_template: '', storage: ''})
const gatewayAddress = ref('')
const gatewayVmid = computed(() => Number(input.vmid_start) + Number(input.seats) * 2)
const gatewayAddresses = computed(() => {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/29$/.exec(props.profile?.managed_gateway?.management_subnet || '')
  if (!match) return []
  const octets = match.slice(1).map(Number), address = octets.reduce((sum, part) => sum * 256 + part, 0)
  if (octets.some(part => part > 255) || address % 8 !== 0) return []
  return Array.from({length: 5}, (_, index) => [24, 16, 8, 0].map(shift => Math.floor((address + index + 2) / 2 ** shift) % 256).join('.'))
})
watch(gatewayAddresses, addresses => { gatewayAddress.value = addresses[0] || '' }, {immediate: true})
const busy = ref(false)
const error = ref('')
const reviewed = ref(false)
let epoch = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
function invalidate() {
  epoch++; clearTimeout(expiryTimer); reviewed.value = false; error.value = ''; busy.value = false; emit('select', null)
}
watch(() => props.profile, profile => {
  if (!profile?.networks?.length || !profile.vmid_ranges?.length || !profile.proxmox_template || !profile.deployer_template || !profile.storage) return
  const range = [...profile.vmid_ranges].sort((a, b) => a[0]! - b[0]!)[0]
  if (!range || range.length !== 2) return
  const address = (subnet: string) => subnet.split('/')[0]!.split('.').reduce((total, part) => total * 256 + Number(part), 0)
  const networks = profile.networks.map(network => ({...network, bridgeNumber: Number(network.bridge.replace(/^vmbr/, '')), address: address(network.subnet)}))
    .sort((a, b) => a.bridgeNumber - b.bridgeNumber)
  let best: {bridge: number; address: number; prefix: number; seats: number} | null = null
  for (const [index, network] of networks.entries()) {
    const limit = Math.min(props.maxSeats, Math.floor((range[1]! - range[0]! + 1 - (profile.managed_gateway ? 1 : 0)) / 2), networks.length - index)
    for (let seats = 1; seats <= limit; seats++) {
      const last = networks[index + seats - 1]!
      if (last.bridgeNumber !== network.bridgeNumber + seats - 1 || last.address !== network.address + 16 * (seats - 1)) break
      const size = 2 ** Math.ceil(Math.log2(seats * 16))
      if (network.address % size === 0 && (!best || seats > best.seats)) best = {bridge: network.bridgeNumber, address: network.address, prefix: 32 - Math.log2(size), seats}
    }
  }
  if (!best) return
  const ip = [24, 16, 8, 0].map(shift => Math.floor(best!.address / 2 ** shift) % 256).join('.')
  Object.assign(input, {vmid_start: range[0], proxmox_template: profile.proxmox_template,
    deployer_template: profile.deployer_template, storage: profile.storage,
    bridge_start: best.bridge, network_pool: `${ip}/${best.prefix}`, seats: Math.min(5, best.seats)})
}, {immediate: true, deep: true})
const specification = computed<WorkshopSpec | null>(() => {
  const expiry = new Date(String(input.expires_at))
  const numbers = ['seats', 'participants_per_environment', 'vmid_start', 'bridge_start', 'proxmox_template', 'deployer_template']
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(String(input.namespace)) || !input.network_pool || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(String(input.storage))
    || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()
    || numbers.some(name => !Number.isSafeInteger(Number(input[name])) || Number(input[name]) < 1)
    || Number(input.seats) < props.minSeats || Number(input.seats) > props.maxSeats
    || Number(input.participants_per_environment) > 10) return null
  const policy = props.profile?.managed_gateway
  if (policy && (!gatewayAddresses.value.includes(gatewayAddress.value) || !props.profile?.vmid_ranges?.some(
    range => range[0]! <= gatewayVmid.value && gatewayVmid.value <= range[1]!))) return null
  return {namespace: String(input.namespace), seats: Number(input.seats), expires_at: expiry.toISOString(),
    vmid_start: Number(input.vmid_start), network_pool: String(input.network_pool), bridge_start: Number(input.bridge_start),
    proxmox_template: Number(input.proxmox_template), deployer_template: Number(input.deployer_template), storage: String(input.storage),
    ...(Number(input.participants_per_environment) === 1 ? {} : {participants_per_environment: Number(input.participants_per_environment)}),
    ...(policy ? {managed_gateway: {...policy, vm_id: gatewayVmid.value, management_ip: gatewayAddress.value}} : {})}
})
watch(input, invalidate, {deep: true})
watch(gatewayAddress, invalidate)
watch(() => props.profile, invalidate, {deep: true})
watch(() => [props.projectId, props.revision, props.path, props.componentId, props.targetHostId, getBackendScope(), backend.token], invalidate)
async function review() {
  if (!specification.value || !props.targetHostId || busy.value) return
  const request = ++epoch
  const workshop = {...specification.value}
  const target = props.targetHostId, scope = getBackendScope()
  busy.value = true; error.value = ''; reviewed.value = false; emit('select', null)
  try {
    const result = await backendRequest<{topology: NativeTopology; allocation_request: {
      vmid_start: number; vmid_end: number;
      networks: Array<{network_id: string; bridge: string; subnet: string; gateway?: string; gateway_node_id?: string}>;
      vms: Array<{node_id: string; vm_id: number; nics: Array<{network_id: string; ip: string}>}>;
    }}>(`/v1/projects/${encodeURIComponent(props.projectId)}/native-scenario/preview`, {
      method: 'POST', body: JSON.stringify({sha: props.revision, path: props.path, workshop,
        ...(props.componentId ? {component_id: props.componentId} : {})}),
    })
    if (request !== epoch) return
    const plan = result.allocation_request
    const reservation = await reserveScenarioAllocation({projectKey: draftKey, targetHostId: target,
      vmidStart: plan.vmid_start, vmidEnd: plan.vmid_end, vms: plan.vms,
      networks: plan.networks.map(net => ({id: net.network_id, vnet: net.bridge, subnet: net.subnet, gateway: net.gateway,
        ...(net.gateway_node_id ? {gateway_node_id: net.gateway_node_id} : {})}))})
    if (request !== epoch) return
    const remaining = Date.parse(reservation.expires_at) - Date.now()
    if (remaining <= 0) throw new Error('Reservation expired; review and reserve again.')
    clearTimeout(expiryTimer)
    expiryTimer = setTimeout(() => { invalidate(); error.value = 'Reservation expired; review and reserve again.' }, remaining)
    reviewed.value = true; emit('select', {workshop, topology: result.topology,
      allocation: {backend_url: scope, target_host_id: target, reservation}})
  } catch (cause) { if (request === epoch) error.value = cause instanceof Error ? cause.message : 'Could not review workshop resources.' }
  finally { if (request === epoch) busy.value = false }
}
onBeforeUnmount(() => { epoch++; clearTimeout(expiryTimer) })
</script>

<template>
  <fieldset class="space-y-4 rounded border border-base-300 p-3" data-testid="independent-workshop-setup">
    <legend class="font-medium">Independent workshop run</legend>
    <p class="text-sm">Participants install Range42 in their own environments. Instance credentials are generated separately for each run. Central application login and laptop network access are configured independently.</p>
    <p v-if="profile" class="text-sm text-base-content/75">Defaults use profile {{ profile.id }}. Keep changes within its approved bounds; live reservation checks availability.</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="field in fields" :key="field.name" class="form-control gap-1">
        <span class="text-sm font-medium">{{ field.label }}</span>
        <input v-model="input[field.name]" :type="field.type" :data-testid="`workshop-input-${field.name}`"
          :min="field.name === 'seats' ? minSeats : field.type === 'number' ? 1 : undefined"
          :max="field.name === 'seats' ? maxSeats : field.name === 'participants_per_environment' ? 10 : undefined" required class="input input-bordered w-full"
          :aria-describedby="`workshop-hint-${field.name}`" />
        <span :id="`workshop-hint-${field.name}`" class="text-xs text-base-content/70">{{ field.hint }}</span>
      </label>
    </div>
    <fieldset v-if="profile?.managed_gateway" data-testid="workshop-managed-gateway" class="rounded border border-base-300 p-3 space-y-3">
      <legend class="font-medium">Managed gateway</legend>
      <p class="text-sm">This run owns a gateway connecting its isolated group networks through {{ profile.managed_gateway.management_bridge }}. Its resources are reserved with the participant VMs.</p>
      <label class="form-control gap-1"><span class="text-sm font-medium">Gateway VMID</span>
        <input :value="gatewayVmid" readonly data-testid="workshop-input-gateway_vm_id" class="input input-bordered w-full" aria-describedby="workshop-gateway-id-hint" />
        <span id="workshop-gateway-id-hint" class="text-xs">The next VMID after the participant pairs.</span>
      </label>
      <label class="form-control gap-1"><span class="text-sm font-medium">Gateway management address</span>
        <select v-model="gatewayAddress" data-testid="workshop-input-gateway_management_ip" class="select select-bordered w-full" aria-describedby="workshop-gateway-address-hint">
          <option v-for="address in gatewayAddresses" :key="address" :value="address">{{ address }}</option>
        </select>
        <span id="workshop-gateway-address-hint" class="text-xs">Choose a distinct address in {{ profile.managed_gateway.management_subnet }} for this run. Reservation checks existing allocations.</span>
      </label>
    </fieldset>
    <p data-testid="workshop-group-summary" class="text-sm">{{ input.seats }} environments · up to {{ Number(input.seats) * Number(input.participants_per_environment) }} participants · {{ Number(input.seats) * 20 }} GiB guest RAM<template v-if="profile?.managed_gateway"> + 4 GiB gateway</template>. A reset replaces the shared environment for its whole group.</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="!reviewed" role="status" class="text-sm">Review the updated resource plan before creating the deployment.</p>
    <p v-else role="status" class="text-sm">VM IDs and addresses are reserved on the selected target. Creating the deployment transfers this reservation to the run. Preflight verifies templates, networks and capacity before execution.</p>
    <button type="button" class="btn btn-outline btn-sm" :disabled="!specification || !targetHostId || busy" data-testid="workshop-review-plan" @click="review">{{ busy ? 'Checking and reserving…' : 'Review and reserve resources' }}</button>
  </fieldset>
</template>

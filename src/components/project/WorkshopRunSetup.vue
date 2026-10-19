<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { reserveScenarioAllocation, type ScenarioReservation } from '@/services/scenarioAllocation'
import type { NativeTopology } from '@/services/nativeScenarioCanvas'

export interface WorkshopSpec {
  namespace: string; seats: number; expires_at: string; vmid_start: number;
  network_pool: string; bridge_start: number; proxmox_template: number; deployer_template: number;
  storage: string;
}
export interface WorkshopSelection {
  workshop: WorkshopSpec; topology: NativeTopology;
  allocation: {backend_url: string; target_host_id: string; reservation: ScenarioReservation};
}
const props = defineProps<{ projectId: string; revision: string; path: string; componentId?: string; targetHostId: string; minSeats: number; maxSeats: number }>()
const emit = defineEmits<{ select: [value: null | WorkshopSelection] }>()
const backend = useBackendApiStore()
const draftKey = `workshop-${crypto.randomUUID()}`
const fields = [
  {name: 'namespace', label: 'Run name', type: 'text', hint: 'Unique short name, such as training-october.'},
  {name: 'seats', label: 'Participants', type: 'number', hint: 'Each participant receives a Proxmox VM and a deployer VM.'},
  {name: 'expires_at', label: 'Workshop ends', type: 'datetime-local', hint: 'Your local time; saved in UTC.'},
  {name: 'vmid_start', label: 'First participant VMID', type: 'number', hint: 'Two consecutive VMIDs per participant. Existing allocations are protected.'},
  {name: 'network_pool', label: 'Participant network pool', type: 'text', hint: 'Private IPv4 CIDR, such as 10.79.0.0/24. One separate /28 per participant.'},
  {name: 'bridge_start', label: 'First participant bridge number', type: 'number', hint: 'For example, 600 uses vmbr600, vmbr601 and so on.'},
  {name: 'proxmox_template', label: 'Nested Proxmox template VMID', type: 'number', hint: 'Reusable qualified template; retained when the run is deleted.'},
  {name: 'deployer_template', label: 'Deployer template VMID', type: 'number', hint: 'Clean Linux template used for the native installation exercise.'},
  {name: 'storage', label: 'Participant VM storage', type: 'text', hint: 'Storage on the selected target for the cloned participant disks.'},
] as const
const input = reactive<Record<string, string | number>>({namespace: '', seats: Math.min(5, props.maxSeats), expires_at: '',
  vmid_start: '', network_pool: '', bridge_start: '', proxmox_template: '', deployer_template: '', storage: ''})
const busy = ref(false)
const error = ref('')
const reviewed = ref(false)
let epoch = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
function invalidate() {
  epoch++; clearTimeout(expiryTimer); reviewed.value = false; error.value = ''; busy.value = false; emit('select', null)
}
const specification = computed<WorkshopSpec | null>(() => {
  const expiry = new Date(String(input.expires_at))
  const numbers = ['seats', 'vmid_start', 'bridge_start', 'proxmox_template', 'deployer_template']
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(String(input.namespace)) || !input.network_pool || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(String(input.storage))
    || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()
    || numbers.some(name => !Number.isSafeInteger(Number(input[name])) || Number(input[name]) < 1)
    || Number(input.seats) < props.minSeats || Number(input.seats) > props.maxSeats) return null
  return {namespace: String(input.namespace), seats: Number(input.seats), expires_at: expiry.toISOString(),
    vmid_start: Number(input.vmid_start), network_pool: String(input.network_pool), bridge_start: Number(input.bridge_start),
    proxmox_template: Number(input.proxmox_template), deployer_template: Number(input.deployer_template), storage: String(input.storage)}
})
watch(input, invalidate, {deep: true})
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
      networks: Array<{network_id: string; bridge: string; subnet: string; gateway?: string}>;
      vms: Array<{node_id: string; vm_id: number; nics: Array<{network_id: string; ip: string}>}>;
    }}>(`/v1/projects/${encodeURIComponent(props.projectId)}/native-scenario/preview`, {
      method: 'POST', body: JSON.stringify({sha: props.revision, path: props.path, workshop,
        ...(props.componentId ? {component_id: props.componentId} : {})}),
    })
    if (request !== epoch) return
    const plan = result.allocation_request
    const reservation = await reserveScenarioAllocation({projectKey: draftKey, targetHostId: target,
      vmidStart: plan.vmid_start, vmidEnd: plan.vmid_end, vms: plan.vms,
      networks: plan.networks.map(net => ({id: net.network_id, vnet: net.bridge, subnet: net.subnet, gateway: net.gateway}))})
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
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="field in fields" :key="field.name" class="form-control gap-1">
        <span class="text-sm font-medium">{{ field.label }}</span>
        <input v-model="input[field.name]" :type="field.type" :data-testid="`workshop-input-${field.name}`"
          :min="field.name === 'seats' ? minSeats : field.type === 'number' ? 1 : undefined"
          :max="field.name === 'seats' ? maxSeats : undefined" required class="input input-bordered w-full"
          :aria-describedby="`workshop-hint-${field.name}`" />
        <span :id="`workshop-hint-${field.name}`" class="text-xs text-base-content/70">{{ field.hint }}</span>
      </label>
    </div>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="!reviewed" role="status" class="text-sm">Review the updated resource plan before creating the deployment.</p>
    <p v-else role="status" class="text-sm">VM IDs and addresses are reserved on the selected target. Creating the deployment transfers this reservation to the run. Preflight verifies templates, networks and capacity before execution.</p>
    <button type="button" class="btn btn-outline btn-sm" :disabled="!specification || !targetHostId || busy" data-testid="workshop-review-plan" @click="review">{{ busy ? 'Checking and reserving…' : 'Review and reserve resources' }}</button>
  </fieldset>
</template>

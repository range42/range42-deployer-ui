<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface Storage {pool_id: string; cluster_id: string; replicas: number; namespace: string; logical_bytes: number}
interface Guest {vm_id: number; memory_mib: number; vcpus: number; storage: Storage[]}
interface Hold {id: string; allocation_id: string; physical_node_id: string; status: string; revision: number; approval_revision: string; approved_by: string; created_at: string; requirements: Guest[]; reservation_recorded: true; root_accepted: false}
interface Status {deployment_id: string; applicable: boolean; hold: Hold | null; live_verified: false; execution_ready: false; infrastructure_qualified: false}
interface Pool {cluster_id: string; replicas: number; available_bytes: number; potential_bytes: number; held_bytes: number; logical_headroom_bytes: number}
interface Cluster {available_bytes: number; potential_bytes: number; held_bytes: number; raw_headroom_bytes: number}
interface Review {deployment_id: string; review_revision: string; physical_node_id: string; node_name: string; observed_at: string; requirements: Guest[];
  resources: {logical_cpus: number; memory_total_mib: number; memory_reserve_mib: number; max_vcpus: number};
  assessment: {admissible: boolean; memory_headroom_mib: number; vcpu_headroom: number; pools: Record<string, Pool>; clusters: Record<string, Cluster>; blocking_codes: string[]; allocation_granted: false};
  execution_ready: false; infrastructure_qualified: false}
const props = defineProps<{deploymentId: string; disabled?: boolean}>()
const emit = defineEmits<{changed: [accepted: boolean]}>()
const backend = useBackendApiStore(), heading = useId()
const state = ref<Status | null>(null), reviewed = ref<Review | null>(null), role = ref(''), error = ref(''), activity = ref('')
const loading = ref(false), refreshButton = ref<HTMLButtonElement | null>(null)
const busy = computed(() => loading.value || !!props.disabled)
const guests = computed(() => reviewed.value?.requirements || state.value?.hold?.requirements || [])
const memory = computed(() => guests.value.reduce((total, guest) => total + guest.memory_mib, 0))
const vcpus = computed(() => guests.value.reduce((total, guest) => total + guest.vcpus, 0))
const disks = computed(() => guests.value.reduce((total, guest) => total + guest.storage.reduce((sum, disk) => sum + disk.logical_bytes, 0), 0))
const gib = (mib: number) => (mib / 1024).toLocaleString(undefined, {maximumFractionDigits: 2})
const diskGiB = (bytes: number) => (bytes / 2 ** 30).toLocaleString(undefined, {maximumFractionDigits: 2})
const hash = (value: unknown, length = 64) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
const quantity = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const signedQuantity = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)
const endpoint = () => `/v1/deployments/${encodeURIComponent(props.deploymentId)}/capacity`
let generation = 0, controller: AbortController | null = null
function invalid(): never { throw new Error('The capacity response could not be verified. Refresh before continuing.') }
function checkGuests(rows: Guest[]) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1024 || new Set(rows.map(row => row?.vm_id)).size !== rows.length || rows.some(row =>
    !row || !quantity(row.vm_id) || row.vm_id < 100 || row.vm_id > 999999999 || !quantity(row.memory_mib) || !row.memory_mib || !quantity(row.vcpus) || !row.vcpus ||
    !Array.isArray(row.storage) || row.storage.length > 16 || row.storage.some(disk => !disk || !hash(disk.pool_id) || !hash(disk.cluster_id) || !quantity(disk.logical_bytes) || !quantity(disk.replicas) || !disk.replicas || disk.replicas > 64 || typeof disk.namespace !== 'string'))) invalid()
}
function accept(value: Status) {
  if (!value || value.deployment_id !== props.deploymentId || typeof value.applicable !== 'boolean' || value.execution_ready !== false || value.infrastructure_qualified !== false || value.live_verified !== false) invalid()
  if (value.hold) {
    const hold = value.hold
    if (!hash(hold.id, 32) || !hash(hold.allocation_id, 32) || !hash(hold.physical_node_id, 32) || !hash(hold.approval_revision) || !quantity(hold.revision) || !hold.revision ||
        !['pending_root', 'active', 'releasing', 'retired'].includes(hold.status) || hold.reservation_recorded !== true || hold.root_accepted !== false || !value.applicable) invalid()
    checkGuests(hold.requirements)
  }
  state.value = value; reviewed.value = null; emit('changed', false)
}
function acceptReview(value: Review) {
  if (!value || value.deployment_id !== props.deploymentId || !hash(value.review_revision) || !hash(value.physical_node_id, 32) || value.execution_ready !== false || value.infrastructure_qualified !== false || !Number.isFinite(Date.parse(value.observed_at))) invalid()
  checkGuests(value.requirements)
  const a = value.assessment, r = value.resources
  if (!a || !r || a.allocation_granted !== false || ![r.logical_cpus, r.memory_total_mib, r.memory_reserve_mib, r.max_vcpus].every(quantity) ||
      !signedQuantity(a.memory_headroom_mib) || !signedQuantity(a.vcpu_headroom) || !a.pools || !a.clusters || !Object.keys(a.pools).length || Object.keys(a.pools).length > 16 || Object.keys(a.clusters).length > 16 || !Array.isArray(a.blocking_codes)) invalid()
  for (const [key, pool] of Object.entries(a.pools)) if (!hash(key) || !pool || !hash(pool.cluster_id) || ![pool.replicas, pool.available_bytes, pool.potential_bytes, pool.held_bytes].every(quantity) || !pool.replicas || pool.replicas > 64 || pool.logical_headroom_bytes !== pool.available_bytes - pool.potential_bytes - pool.held_bytes) invalid()
  for (const [key, cluster] of Object.entries(a.clusters)) if (!hash(key) || !cluster || ![cluster.available_bytes, cluster.potential_bytes, cluster.held_bytes].every(quantity) || cluster.raw_headroom_bytes !== cluster.available_bytes - cluster.potential_bytes - cluster.held_bytes) invalid()
  const reasons = [a.memory_headroom_mib < 0 ? 'MEMORY_COMMITTED' : '', a.vcpu_headroom < 0 ? 'CPU_BUDGET_COMMITTED' : '', Object.values(a.pools).some(p => p.logical_headroom_bytes < 0) || Object.values(a.clusters).some(c => c.raw_headroom_bytes < 0) ? 'SHARED_STORAGE_COMMITTED' : ''].filter(Boolean)
  if (a.admissible !== !reasons.length || JSON.stringify([...a.blocking_codes].sort()) !== JSON.stringify(reasons.sort())) invalid()
  reviewed.value = value
}
function reset() { generation++; controller?.abort(); controller = null; state.value = null; reviewed.value = null; loading.value = false; role.value = ''; error.value = ''; activity.value = ''; emit('changed', false) }
watch(() => [props.deploymentId, props.disabled, backend.activeHost?.id, getBackendScope(), backend.token], reset, {flush: 'sync'})
onBeforeUnmount(() => { generation++; controller?.abort() })
function message(cause: unknown) {
  if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 404) return 'Capacity reservation is not available on this backend. Update the backend before preparing this workshop.'
  return cause instanceof Error ? cause.message : 'Could not verify this reservation. Refresh before retrying.'
}
async function readStatus(current: number) { const result = await backendRequest<Status>(endpoint(), {signal: controller?.signal}); if (current === generation) accept(result) }
async function refresh() {
  if (busy.value) return
  const current = generation; controller = new AbortController(); loading.value = true; state.value = null; reviewed.value = null; role.value = ''; error.value = ''; activity.value = 'Reading retained capacity…'; emit('changed', false)
  try { const identity = await backendRequest<{role: string}>('/v1/auth/me', {signal: controller.signal}); if (current !== generation) return; role.value = identity.role; if (identity.role === 'admin') await readStatus(current) }
  catch (cause) { if (current === generation) error.value = message(cause) }
  finally { if (current === generation) { loading.value = false; activity.value = '' } }
}
async function inspect() {
  if (busy.value || role.value !== 'admin' || !state.value?.applicable || state.value.hold) return
  const current = generation; controller = new AbortController(); loading.value = true; reviewed.value = null; error.value = ''; activity.value = 'Checking configured resources and competing reservations. This can take up to two minutes…'
  try { const result = await backendRequest<Review>(endpoint() + '/review', {method: 'POST', body: '{}', signal: controller.signal}); if (current === generation) acceptReview(result) }
  catch (cause) { if (current === generation) error.value = message(cause) }
  finally { if (current === generation) { loading.value = false; activity.value = '' } }
}
async function reserve() {
  if (busy.value || role.value !== 'admin' || !reviewed.value?.assessment.admissible || state.value?.hold) return
  const current = generation, revision = reviewed.value.review_revision; controller = new AbortController(); loading.value = true; error.value = ''; activity.value = 'Rechecking and reserving the reviewed resources…'
  try { const result = await backendRequest<Status>(endpoint(), {method: 'POST', body: JSON.stringify({review_revision: revision}), signal: controller.signal}); if (current === generation) accept(result) }
  catch (cause) { if (current === generation) { reviewed.value = null; error.value = message(cause); try { await readStatus(current) } catch { if (current === generation) state.value = null } } }
  finally { if (current === generation) { loading.value = false; activity.value = ''; await nextTick(); if (current === generation) refreshButton.value?.focus() } }
}
</script>

<template>
  <section class="mb-4 rounded border border-base-300 p-4 space-y-3" :aria-labelledby="heading" data-testid="deployment-capacity">
    <h3 :id="heading" class="font-semibold">Workshop resources</h3>
    <p class="text-sm">Review this run’s configured resources against the physical server and shared storage, including other retained reservations.</p>
    <button ref="refreshButton" type="button" class="btn btn-outline btn-sm" data-testid="capacity-refresh" :disabled="busy" @click="refresh">{{ state ? 'Refresh reservation' : 'Load capacity reservation' }}</button>
    <p v-if="activity" role="status">{{ activity }}</p>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="role && role !== 'admin'" role="status">An administrator must review and reserve this workshop’s physical resources.</p>
    <p v-if="state && !state.applicable" role="status">This deployment does not declare a managed workshop resource plan.</p>
    <template v-if="state?.hold">
      <p v-if="state.hold.status === 'pending_root'" role="status" class="alert alert-info"><strong>Physical acceptance pending.</strong> The reservation is recorded. Virtual machine operations remain blocked until the original physical-node acceptance and execution checks pass.</p>
      <p v-else-if="state.hold.status === 'retired'" role="status">Reservation retired. Create a new run to reserve resources again.</p>
      <p v-else role="status">The retained reservation requires native reconciliation. Virtual machine operations remain blocked.</p>
      <p class="text-sm">Recorded by {{ state.hold.approved_by }} at {{ state.hold.created_at }}. Stopping a guest or a failed attempt does not release its reservation.</p>
    </template>
    <button v-else-if="state?.applicable && role === 'admin'" type="button" class="btn btn-outline btn-sm" data-testid="capacity-review" :disabled="busy" @click="inspect">Review workshop capacity</button>
    <template v-if="reviewed">
      <p class="font-medium">Reviewed physical server · {{ reviewed.node_name }}</p>
      <p class="text-sm">{{ gib(reviewed.resources.memory_total_mib) }} GiB physical memory, including a {{ gib(reviewed.resources.memory_reserve_mib) }} GiB host reserve. Current and pending guest configuration stay charged while stopped.</p>
      <p v-if="reviewed.assessment.memory_headroom_mib < 0" role="status" class="alert alert-warning">{{ gib(-reviewed.assessment.memory_headroom_mib) }} GiB over the memory budget. Reduce the deployment size or retire another run before trying again.</p>
      <p v-else class="text-sm">{{ gib(reviewed.assessment.memory_headroom_mib) }} GiB remains after this reservation.</p>
      <p v-if="reviewed.assessment.vcpu_headroom < 0" role="status" class="alert alert-warning">The shared CPU budget is exceeded by {{ -reviewed.assessment.vcpu_headroom }} virtual CPUs.</p>
      <p v-else class="text-sm">{{ reviewed.assessment.vcpu_headroom }} shared virtual CPUs remain after this reservation; the budget is {{ reviewed.resources.max_vcpus }} on {{ reviewed.resources.logical_cpus }} logical host CPUs.</p>
      <p v-if="reviewed.assessment.blocking_codes.includes('SHARED_STORAGE_COMMITTED')" role="status" class="alert alert-warning">The run exceeds the shared storage budget, including replication. Retire another allocation or choose a smaller deployment.</p>
      <p v-for="(pool, poolId) in reviewed.assessment.pools" :key="poolId" class="text-sm"><template v-if="pool.logical_headroom_bytes < 0">{{ diskGiB(-pool.logical_headroom_bytes) }} GiB over the shared storage budget.</template><template v-else>Shared storage: {{ diskGiB(pool.logical_headroom_bytes) }} GiB logical space remains after this reservation, with {{ pool.replicas }} replicas accounted for.</template></p>
      <p v-for="(cluster, clusterId) in reviewed.assessment.clusters" :key="clusterId" class="text-sm"><template v-if="cluster.raw_headroom_bytes < 0">{{ diskGiB(-cluster.raw_headroom_bytes) }} GiB over the shared physical storage budget.</template><template v-else>Shared physical storage: {{ diskGiB(cluster.raw_headroom_bytes) }} GiB remains after replication and retained commitments.</template></p>
      <p class="text-sm">This review reserves no resources. Reserving records the original plan; physical acceptance and environment preparation are still required before deployment.</p>
    </template>
    <div v-if="guests.length" class="space-y-2">
      <p class="font-medium">{{ guests.length }} guests · {{ gib(memory) }} GiB RAM · {{ vcpus }} virtual CPUs · {{ diskGiB(disks) }} GiB virtual disks</p>
      <div class="overflow-x-auto" role="region" aria-label="Workshop resource requirements" tabindex="0">
        <table class="table table-sm"><caption class="text-left">Exact run requirements</caption><thead><tr><th scope="col">VM ID</th><th scope="col">Memory</th><th scope="col">vCPUs</th><th scope="col">Disk size</th></tr></thead>
          <tbody><tr v-for="guest in guests" :key="guest.vm_id"><th scope="row">{{ guest.vm_id }}</th><td>{{ gib(guest.memory_mib) }} GiB</td><td>{{ guest.vcpus }}</td><td>{{ diskGiB(guest.storage.reduce((total, disk) => total + disk.logical_bytes, 0)) }} GiB</td></tr></tbody>
        </table>
      </div>
    </div>
    <button v-if="reviewed?.assessment.admissible && !state?.hold" type="button" class="btn btn-primary btn-sm" data-testid="capacity-reserve" :disabled="busy" @click="reserve">Reserve reviewed resources</button>
  </section>
</template>

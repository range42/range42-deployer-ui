<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { captureCapacityConnection, listCapacityTargets, readHostCapacity, type CapacityTarget, type HostCapacity } from '@/services/proxmox/capacity'

const props = defineProps<{ backendId: string; nodeName: string }>()
const backend = useBackendApiStore()
const connection = computed(() => backend.getHost(props.backendId))
const headingId = useId()
const targetId = useId()
const hosts = ref<CapacityTarget[]>([])
const selected = ref('')
const data = ref<HostCapacity | null>(null)
const busy = ref(false)
const error = ref('')
const loaded = ref(false)
let operation = 0
let controller: AbortController | null = null
const canLoad = computed(() => !!connection.value && !!props.nodeName.trim())

function reset() {
  operation += 1
  controller?.abort()
  hosts.value = []; selected.value = ''; data.value = null; error.value = ''; busy.value = false; loaded.value = false
}
watch([() => props.backendId, () => connection.value?.url, () => connection.value?.token, () => props.nodeName], reset, { flush: 'sync' })
onBeforeUnmount(reset)

async function load(refreshTargets: boolean) {
  if (!canLoad.value) return
  const stamp = ++operation
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  data.value = null; error.value = ''; busy.value = true
  try {
    const snapshot = captureCapacityConnection(props.backendId)
    if (refreshTargets) {
      const targets = await listCapacityTargets(snapshot, signal)
      if (stamp !== operation) return
      hosts.value = targets.filter(host => host.node_name === props.nodeName.trim())
      if (selected.value && !hosts.value.some(host => host.id === selected.value)) {
        selected.value = ''
        throw new Error('The previously selected target is no longer registered for this node. Select a target again.')
      }
      if (!loaded.value && hosts.value.length === 1) selected.value = hosts.value[0].id
      loaded.value = true
      if (!hosts.value.length) throw new Error('No registered Proxmox target matches this node on the selected backend. Check the node name and backend host registration.')
    }
    const target = hosts.value.find(host => host.id === selected.value)
    if (!target) return
    const result = await readHostCapacity(snapshot, target, signal)
    if (stamp === operation) data.value = result
  } catch (cause) {
    if (stamp === operation) error.value = cause instanceof Error ? cause.message : 'Capacity could not be loaded. Refresh to try again.'
  } finally { if (stamp === operation) busy.value = false }
}
function selectTarget(event: Event) {
  selected.value = (event.target as HTMLSelectElement).value
  void load(false)
}
const status = computed(() => ({ available: 'Measurements available', partial: 'Partial measurements', unavailable: 'Measurements unavailable' })[data.value?.status || 'unavailable'])
const number = (value: number) => new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: 1 }).format(value)
function formatBytes(value: number | null): string {
  if (value === null) return 'Unknown'
  const unit = value ? Math.min(5, Math.floor(Math.log(value) / Math.log(1024))) : 0
  return `${number(value / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'][unit]}`
}
const byteTitle = (value: number | null) => value === null ? 'Measurement unavailable' : `${new Intl.NumberFormat().format(value)} bytes`
const byteLabels = { total_bytes: 'Total', used_bytes: 'Used', free_bytes: 'Free' } as const
const observed = computed(() => data.value ? new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(data.value.observed_at)) : '')
const loadPercent = computed(() => data.value?.cpu.utilization == null ? 'Unknown' : new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'percent', maximumFractionDigits: 1 }).format(data.value.cpu.utilization))
</script>

<template>
  <section :aria-labelledby="headingId" class="rounded-xl border border-base-300 p-4 mb-4 min-w-0" data-testid="capacity-panel">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h4 :id="headingId" class="font-semibold text-base">Measured host capacity</h4>
      <button type="button" class="btn btn-outline btn-sm focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="capacity-refresh" :disabled="busy || !canLoad" @click="load(true)">
        {{ busy ? 'Loading…' : loaded ? 'Refresh capacity' : 'Load capacity' }}
      </button>
    </div>
    <p v-if="connection" class="text-xs text-base-content/80 break-words mt-2">Backend: <span translate="no">{{ connection.url }}</span> · Node: <span translate="no">{{ nodeName.trim() || 'Not selected' }}</span></p>
    <p v-else class="text-sm mt-3">No saved backend matches this URL. Add the connection and its API token in Settings to view capacity.</p>
    <p v-if="connection && !nodeName.trim()" class="text-sm mt-3">Enter a Proxmox node above before loading capacity.</p>
    <label v-if="hosts.length" :for="targetId" class="form-control block mt-4">
      <span class="block text-sm font-medium mb-1">Registered Proxmox target</span>
      <select :id="targetId" :value="selected" name="capacity_target" class="select select-bordered w-full focus-visible:outline-2 focus-visible:outline-offset-2" data-testid="capacity-target" @change="selectTarget">
        <option value="" disabled>Choose the target to measure</option>
        <option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.name }} · {{ host.api_url || host.id }}</option>
      </select>
    </label>
    <p v-if="hosts.length > 1 && !selected" class="text-sm mt-2">Several registered targets match this node. Choose one before loading measurements.</p>
    <p v-if="busy" role="status" aria-live="polite" class="text-sm mt-3">Reading current measurements…</p>
    <p v-if="error" role="alert" class="text-sm text-error mt-3 break-words">{{ error }}</p>
    <template v-if="data">
      <p role="status" aria-live="polite" class="text-sm font-medium mt-4">{{ status }}</p>
      <p class="text-xs text-base-content/80 mt-1">Observed <time :datetime="data.observed_at">{{ observed }}</time>. Values can change immediately.</p>
      <div class="grid gap-4 mt-4 sm:grid-cols-2 min-w-0">
        <section class="rounded-lg bg-base-200 p-3 min-w-0">
          <h5 class="font-medium text-sm">CPU hardware and current load</h5>
          <dl class="grid grid-cols-2 gap-3 mt-2 tabular-nums text-sm">
            <div><dt class="text-base-content/80">Hardware</dt><dd class="font-semibold">{{ data.cpu.logical_cpus === null ? 'Unknown' : `${number(data.cpu.logical_cpus)} logical CPUs` }}</dd></div>
            <div><dt class="text-base-content/80">Current load</dt><dd class="font-semibold">{{ loadPercent }}</dd></div>
          </dl>
          <p class="text-xs text-base-content/80 mt-3">VMs share these CPUs. This sample does not measure exclusive free cores.</p>
        </section>
        <section class="rounded-lg bg-base-200 p-3 min-w-0">
          <h5 class="font-medium text-sm">Memory</h5>
          <dl class="grid grid-cols-3 gap-2 mt-2 tabular-nums text-sm">
            <div v-for="(label, key) in byteLabels" :key="key"><dt class="text-base-content/80">{{ label }}</dt><dd class="font-semibold" :title="byteTitle(data.memory[key])">{{ formatBytes(data.memory[key]) }}</dd></div>
          </dl>
        </section>
      </div>
      <h5 class="font-medium text-sm mt-4">Storage pools</h5>
      <p v-if="!data.storage.length" class="text-sm mt-2">No storage pools were visible. API permissions may hide pools; this is not a zero-capacity measurement.</p>
      <ul v-else class="space-y-3 mt-2">
        <li v-for="pool in data.storage" :key="pool.storage" class="rounded-lg border border-base-300 p-3 min-w-0 [content-visibility:auto]">
          <div class="flex flex-wrap justify-between gap-2 text-sm">
            <span class="font-semibold break-all" translate="no">{{ pool.storage }}</span>
            <span>{{ pool.active === false || pool.enabled === false ? 'Inactive or disabled' : pool.active === null || pool.enabled === null ? 'Availability unknown' : 'Active' }} · {{ pool.shared === null ? 'Sharing unknown' : pool.shared ? 'Shared storage' : 'Local storage' }}</span>
          </div>
          <p class="text-xs text-base-content/80 break-words mt-1">{{ pool.type || 'Unknown storage type' }} · {{ pool.content.join(', ') || 'Content types unknown' }}</p>
          <dl class="grid grid-cols-3 gap-2 mt-2 tabular-nums text-sm">
            <div v-for="(label, key) in byteLabels" :key="key"><dt class="text-base-content/80">{{ label }}</dt><dd :title="byteTitle(pool[key])">{{ formatBytes(pool[key]) }}</dd></div>
          </dl>
        </li>
      </ul>
      <ul v-if="data.issues.length" class="list-disc pl-5 mt-4 text-sm space-y-1" aria-label="Capacity measurement issues">
        <li v-for="(issue, index) in data.issues" :key="`${issue.code}-${index}`" class="break-words">{{ issue.message }}</li>
      </ul>
      <p class="text-xs text-base-content/80 mt-4">Measurements are not reservations. Deployment preflight compares the concrete plan; external activity can change capacity.</p>
      <details v-if="data.limitations.length" class="mt-3 text-xs text-base-content/80">
        <summary class="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2">Measurement limits</summary>
        <ul class="list-disc pl-5 mt-2 space-y-1"><li v-for="limit in data.limitations" :key="limit" class="break-words">{{ limit }}</li></ul>
      </details>
    </template>
  </section>
</template>

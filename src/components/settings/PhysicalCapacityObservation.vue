<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface Guest { vm_id: number; kind: string; state: string; template: boolean; resumable: boolean; memory_mib: number; vcpus: number }
interface Storage { storage: string; namespace: string; pool_id: string; cluster_id: string; replicas: number; logical_available_bytes: number; cluster_raw_available_bytes: number; potential_bytes: number; volumes: {volume: string; size_bytes: number}[] }
interface ResourceReview {
  target_host_id: string; observed_at: string;
  observation: { protocol: string; node: {physical_node_id: string; execution_ready: false; infrastructure_qualified: false}; resources: {
    logical_cpus: number; memory_total_mib: number; max_vcpus: number; memory_reserve_mib: number; guests: Guest[]; storage: Storage[];
    execution_ready: false; infrastructure_qualified: false;
  }};
  summary: {configured_memory_mib: number; memory_headroom_mib: number; configured_vcpus: number; vcpu_headroom: number; resumable_guests: number;
    allocation_granted: false; execution_ready: false; infrastructure_qualified: false};
}
const props = defineProps<{hostId: string; physicalNodeId: string; disabled?: boolean}>()
const backend = useBackendApiStore(), heading = useId()
const reviewed = ref<ResourceReview | null>(null), busy = ref(false), error = ref('')
let generation = 0, controller: AbortController | null = null
function reset() { generation++; controller?.abort(); controller = null; reviewed.value = null; busy.value = false; error.value = '' }
watch(() => [props.hostId, props.physicalNodeId, props.disabled, getBackendScope(), backend.token], reset, {flush: 'sync'})
onBeforeUnmount(reset)
const resources = computed(() => reviewed.value?.observation.resources)
const gib = (mib: number) => (mib / 1024).toLocaleString(undefined, {maximumFractionDigits: 2})
const diskGiB = (bytes: number) => (bytes / 2 ** 30).toLocaleString(undefined, {maximumFractionDigits: 2})
const quantity = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function valid(value: ResourceReview): boolean {
  const r = value?.observation?.resources, s = value?.summary, n = value?.observation?.node
  if (!r || !s || !n || value.target_host_id !== props.hostId || n.physical_node_id !== props.physicalNodeId ||
      value.observation.protocol !== 'range42-capacity-observation-v1' || !Number.isFinite(Date.parse(value.observed_at)) ||
      [n.execution_ready, n.infrastructure_qualified, r.execution_ready, r.infrastructure_qualified, s.allocation_granted, s.execution_ready, s.infrastructure_qualified].some(v => v !== false) ||
      ![r.logical_cpus, r.memory_total_mib, r.max_vcpus, r.memory_reserve_mib].every(quantity) ||
      !Array.isArray(r.guests) || r.guests.length > 1024 || !Array.isArray(r.storage) || !r.storage.length || r.storage.length > 16) return false
  if (r.guests.some(g => !g || !quantity(g.vm_id) || !quantity(g.memory_mib) || !quantity(g.vcpus) ||
      !['qemu', 'lxc'].includes(g.kind) || !['running', 'stopped', 'paused', 'suspended'].includes(g.state) ||
      typeof g.template !== 'boolean' || typeof g.resumable !== 'boolean' ||
      (g.template ? g.resumable || g.memory_mib !== 0 || g.vcpus !== 0 || g.state !== 'stopped' : !g.resumable || !g.memory_mib || !g.vcpus))) return false
  if (new Set(r.guests.map(g => g.vm_id)).size !== r.guests.length) return false
  if (r.storage.some(p => !p || typeof p.storage !== 'string' || !/^[a-f0-9]{64}$/.test(p.pool_id) || !/^[a-f0-9]{64}$/.test(p.cluster_id) ||
      ![p.replicas, p.logical_available_bytes, p.cluster_raw_available_bytes, p.potential_bytes].every(quantity) || !p.replicas ||
      !Array.isArray(p.volumes) || p.volumes.length > 4096 || p.volumes.some(v => typeof v.volume !== 'string' || !quantity(v.size_bytes)) ||
      new Set(p.volumes.map(v => v.volume)).size !== p.volumes.length || p.volumes.reduce((total, v) => total + v.size_bytes, 0) !== p.potential_bytes)) return false
  const memory = r.guests.reduce((total, g) => total + g.memory_mib, 0), cpus = r.guests.reduce((total, g) => total + g.vcpus, 0)
  return s.configured_memory_mib === memory && s.configured_vcpus === cpus &&
    s.memory_headroom_mib === r.memory_total_mib - r.memory_reserve_mib - memory && s.vcpu_headroom === r.max_vcpus - cpus &&
    s.resumable_guests === r.guests.filter(g => g.resumable).length
}
async function inspect() {
  if (busy.value || props.disabled) return
  const current = generation; busy.value = true; reviewed.value = null; error.value = ''; controller = new AbortController()
  try {
    const value = await backendRequest<ResourceReview>(`/v1/proxmox/hosts/${encodeURIComponent(props.hostId)}/physical-node/capacity/review`, {method: 'POST', body: '{}', signal: controller.signal})
    if (current !== generation) return
    if (!valid(value)) throw new Error('The resource observation does not match this physical server or its configured commitments.')
    reviewed.value = value
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : 'Could not read configured resources. Check the dedicated inspector enrollment and retry.' }
  finally { if (current === generation) busy.value = false }
}
</script>

<template>
  <section class="space-y-3 border-t border-base-300 pt-3" :aria-labelledby="heading">
    <h4 :id="heading" class="font-medium">Configured resources</h4>
    <p class="text-sm">Read the server’s full commitments, including current and pending configuration. Stopped guests retain their configured resources.</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="read-physical-capacity" :disabled="disabled || busy" @click="inspect">{{ reviewed ? 'Refresh configured resources' : 'Read configured resources' }}</button>
    <p v-if="busy" role="status">Reading configured resources and checking for changes. This can take up to two minutes…</p>
    <p v-if="error" role="alert" data-testid="physical-capacity-error" class="alert alert-error">{{ error }}</p>
    <div v-if="reviewed && resources" data-testid="physical-capacity-observation" class="space-y-3">
      <p class="text-sm">Observed {{ reviewed.observed_at }}. No capacity has been reserved. Deployment still requires capacity admission and environment preparation.</p>
      <p v-if="reviewed.summary.memory_headroom_mib < 0" role="status" class="alert alert-warning">{{ gib(-reviewed.summary.memory_headroom_mib) }} GiB over the memory budget, including the host reserve. Release capacity through a controlled maintenance operation or reduce the deployment size.</p>
      <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt>Physical memory</dt><dd>{{ gib(resources.memory_total_mib) }} GiB</dd>
        <dt>Host reserve</dt><dd>{{ gib(resources.memory_reserve_mib) }} GiB</dd>
        <dt>Configured guest memory</dt><dd>{{ gib(reviewed.summary.configured_memory_mib) }} GiB</dd>
        <dt>Memory headroom</dt><dd>{{ gib(reviewed.summary.memory_headroom_mib) }} GiB</dd>
        <dt>Configured virtual CPUs</dt><dd>{{ reviewed.summary.configured_vcpus }} against a shared budget of {{ resources.max_vcpus }}; {{ resources.logical_cpus }} logical host CPUs</dd>
      </dl>
      <div class="overflow-x-auto" role="region" aria-label="Guest resource commitments" tabindex="0">
        <table class="table table-sm">
          <caption class="text-left font-medium">Guest commitments · {{ reviewed.summary.resumable_guests }} resumable guests</caption>
          <thead><tr><th scope="col">VM ID</th><th scope="col">Type</th><th scope="col">State</th><th scope="col">Memory</th><th scope="col">vCPUs</th></tr></thead>
          <tbody><tr v-for="guest in resources.guests" :key="guest.vm_id"><th scope="row">{{ guest.vm_id }}</th><td>{{ guest.template ? 'Template' : guest.kind }}</td><td>{{ guest.state }}</td><td>{{ gib(guest.memory_mib) }} GiB</td><td>{{ guest.vcpus }}</td></tr></tbody>
        </table>
      </div>
      <div v-for="storage in resources.storage" :key="storage.storage" class="rounded bg-base-200 p-3 text-sm space-y-1">
        <p class="font-medium">{{ storage.storage }}</p>
        <p>{{ diskGiB(storage.logical_available_bytes) }} GiB observed logical space; {{ storage.replicas }} replicas.</p>
        <p>{{ storage.volumes.length }} volumes with {{ diskGiB(storage.potential_bytes) }} GiB of full virtual disk sizes. Storage aliases and namespaces can share the same physical budget.</p>
      </div>
    </div>
  </section>
</template>

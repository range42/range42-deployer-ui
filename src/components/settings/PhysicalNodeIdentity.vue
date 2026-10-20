<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface NodeReview {
  revision: string; target_host_id: string; physical_node_id: string; node_name: string;
  hardware_binding: string; api_certificate_sha256: string; node_certificate_sha256: string; boot_id: string;
  configuration_revision: string; supported_operations: string[]; execution_ready: false; infrastructure_qualified: false;
}
interface Binding extends Omit<NodeReview, 'revision' | 'configuration_revision' | 'supported_operations'> {
  binding_recorded: true; live_verified: false; alias_count: number; recorded_at: string;
}
interface Snapshot { target_host_id: string; configuration_state: 'enrolled' | 'unavailable'; binding: Binding | null; needs_review: boolean }
const props = defineProps<{hostId: string; disabled?: boolean}>()
const backend = useBackendApiStore(), headingId = useId()
const snapshot = ref<Snapshot | null>(null), reviewed = ref<NodeReview | null>(null)
const busy = ref(false), error = ref(''), notice = ref('')
const inspectButton = ref<HTMLButtonElement | null>(null)
let generation = 0, controller: AbortController | null = null
function reset() {
  generation++; controller?.abort(); controller = null
  snapshot.value = null; reviewed.value = null; busy.value = false; error.value = ''; notice.value = ''
}
watch(() => [props.hostId, getBackendScope(), backend.token], reset, {flush: 'sync'})
onBeforeUnmount(reset)
const endpoint = () => `/v1/proxmox/hosts/${encodeURIComponent(props.hostId)}/physical-node`
function message(cause: unknown) {
  if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 404) return 'Physical-node inspection is not available on this backend.'
  return cause instanceof Error ? cause.message : 'Could not verify this physical node. Refresh before retrying.'
}
async function readSnapshot(current: number) {
  const result = await backendRequest<Snapshot>(endpoint(), {signal: controller?.signal})
  if (current !== generation) return
  if (result.target_host_id !== props.hostId || !['enrolled', 'unavailable'].includes(result.configuration_state)) throw new Error('The recorded node does not match this target.')
  snapshot.value = result
}
async function load() {
  if (busy.value || props.disabled) return
  const current = generation; busy.value = true; error.value = ''; notice.value = ''; reviewed.value = null; controller = new AbortController()
  try { await readSnapshot(current) }
  catch (cause) { if (current === generation) error.value = message(cause) }
  finally { if (current === generation) busy.value = false }
}
async function inspect() {
  if (busy.value || props.disabled || snapshot.value?.configuration_state !== 'enrolled') return
  const current = generation; busy.value = true; error.value = ''; notice.value = ''; reviewed.value = null; controller = new AbortController()
  try {
    const result = await backendRequest<NodeReview>(endpoint() + '/review', {method: 'POST', body: '{}', signal: controller.signal})
    if (current !== generation) return
    if (result.target_host_id !== props.hostId || result.execution_ready !== false || result.infrastructure_qualified !== false ||
        !/^[a-f0-9]{64}$/.test(result.revision) || !/^[a-f0-9]{32}$/.test(result.physical_node_id) || !/^[a-f0-9]{64}$/.test(result.api_certificate_sha256) || !/^[a-f0-9]{64}$/.test(result.node_certificate_sha256)) throw new Error('The node inspection does not match this target or its supported readiness state.')
    reviewed.value = result
  } catch (cause) { if (current === generation) error.value = message(cause) }
  finally { if (current === generation) busy.value = false }
}
async function save() {
  if (busy.value || props.disabled || !reviewed.value) return
  const current = generation, revision = reviewed.value.revision
  busy.value = true; error.value = ''; notice.value = ''; controller = new AbortController()
  try {
    await backendRequest<Binding>(endpoint(), {method: 'POST', body: JSON.stringify({review_revision: revision}), signal: controller.signal})
    if (current !== generation) return
    reviewed.value = null; notice.value = 'Physical identity recorded.'
    await readSnapshot(current)
  } catch (cause) {
    if (current === generation) {
      reviewed.value = null; error.value = message(cause)
      // A lost reply may follow a committed record. Read the durable binding;
      // another save always requires a deliberate fresh inspection.
      try { await readSnapshot(current) }
      catch { if (current === generation) snapshot.value = null }
    }
  } finally {
    if (current === generation) {
      busy.value = false
      await nextTick()
      if (current === generation) inspectButton.value?.focus()
    }
  }
}
</script>

<template>
  <section class="rounded border border-base-300 p-4 space-y-3" data-testid="physical-node-identity" :aria-labelledby="headingId">
    <h3 :id="headingId" class="font-semibold">Physical server identity</h3>
    <p class="text-sm">Record which physical server this target reaches. Preparation and capacity admission are still required.</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="load-physical-node" :disabled="disabled || busy" @click="load">{{ snapshot ? 'Refresh recorded identity' : 'Load node identity' }}</button>
    <p v-if="busy" role="status">Checking node identity…</p>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="notice" role="status" class="alert alert-info">{{ notice }}</p>
    <template v-if="snapshot">
      <p v-if="snapshot.configuration_state === 'unavailable'" role="status">The dedicated node inspector is not enrolled for this target. Complete its one-time infrastructure enrollment before verifying its identity.</p>
      <p v-if="snapshot.needs_review && snapshot.binding" role="status">The target or inspector configuration changed. Inspect it again before using the recorded binding.</p>
      <div v-if="snapshot.binding" class="space-y-2">
        <p class="font-medium">Recorded node · {{ snapshot.binding.node_name }}</p>
        <p class="text-sm break-all">{{ snapshot.binding.physical_node_id }}</p>
        <p class="text-sm">{{ snapshot.binding.alias_count }} registered targets refer to this physical node.</p>
        <p class="text-xs break-words">Recorded {{ snapshot.binding.recorded_at }}. Live inspection is required before provisioning.</p>
      </div>
      <button v-if="snapshot.configuration_state === 'enrolled'" ref="inspectButton" type="button" class="btn btn-sm" data-testid="inspect-physical-node" :disabled="disabled || busy" @click="inspect">Inspect node</button>
    </template>
    <div v-if="reviewed" class="rounded bg-base-200 p-3 space-y-3" data-testid="physical-node-review">
      <p class="font-medium">Verified SSH and HTTPS refer to this node</p>
      <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt>Node</dt><dd class="min-w-0 break-all">{{ reviewed.node_name }}</dd>
        <dt>Physical node ID</dt><dd class="min-w-0 break-all"><code>{{ reviewed.physical_node_id }}</code></dd>
        <dt>API certificate SHA256</dt><dd class="min-w-0 break-all"><code>{{ reviewed.api_certificate_sha256 }}</code></dd>
        <dt>Node certificate SHA256</dt><dd class="min-w-0 break-all"><code>{{ reviewed.node_certificate_sha256 }}</code></dd>
        <dt>Current boot</dt><dd class="min-w-0 break-all"><code>{{ reviewed.boot_id }}</code></dd>
      </dl>
      <p class="text-sm">This records identity. It does not prepare or start virtual machines.</p>
      <button type="button" class="btn btn-primary btn-sm" data-testid="save-physical-node" :disabled="disabled || busy" @click="save">Record reviewed identity</button>
    </div>
  </section>
</template>

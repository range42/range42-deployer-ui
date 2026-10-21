<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface Network {bridge: string; subnet: string; gateway: string}
interface Status {
  deployment_id: string; requested: boolean; environment_id: string;
  request_recorded: boolean; preparation_available: boolean; execution_ready: false; issue: string;
  plan: null | {environment_id: string; owner: string; networks: Network[]; management: {bridge: string; subnet: string; host_address: string}};
  receipt: null | {status: 'absent' | 'preparing' | 'ready'; environment_id: string; request_digest: string;
    network_ready: boolean; execution_ready: false; proof: null | {request_digest: string}};
}
const props = defineProps<{deploymentId: string; environmentId: string; disabled?: boolean}>()
const emit = defineEmits<{changed: [available: boolean]}>()
const backend = useBackendApiStore(), heading = useId()
const state = ref<Status | null>(null), loading = ref(false), error = ref('')
const busy = computed(() => loading.value || !!props.disabled)
let generation = 0, controller: AbortController | null = null
function invalidate() {
  generation++; controller?.abort(); state.value = null; loading.value = false; error.value = ''; emit('changed', false)
}
watch([() => props.deploymentId, () => props.environmentId, () => props.disabled, getBackendScope, () => backend.token], invalidate)
onBeforeUnmount(() => {generation++; controller?.abort()})
function accept(value: Status) {
  if (!value || value.deployment_id !== props.deploymentId || value.environment_id !== props.environmentId || value.requested !== true
      || typeof value.request_recorded !== 'boolean' || typeof value.preparation_available !== 'boolean'
      || typeof value.issue !== 'string' || value.execution_ready !== false
      || value.preparation_available && !value.request_recorded) throw new Error('The environment network response could not be verified.')
  if (value.plan && (value.plan.environment_id !== props.environmentId || value.plan.owner !== 'range42-environment:'+props.environmentId
      || !Array.isArray(value.plan.networks) || !value.plan.networks.length || value.plan.networks.length > 64
      || value.plan.networks.some(row => !/^vmbr[1-9][0-9]{2,4}$/.test(row.bridge) || typeof row.subnet !== 'string')
      || new Set(value.plan.networks.map(row => row.bridge)).size !== value.plan.networks.length
      || !value.plan.management || !/^vmbr[1-9][0-9]{2,4}$/.test(value.plan.management.bridge)
      || typeof value.plan.management.subnet !== 'string')) throw new Error('The environment network response could not be verified.')
  if (value.preparation_available && !value.plan) throw new Error('The environment network response could not be verified.')
  if (value.receipt && (!value.request_recorded || !value.plan || value.receipt.environment_id !== props.environmentId
      || !['absent', 'preparing', 'ready'].includes(value.receipt.status)
      || typeof value.receipt.network_ready !== 'boolean' || value.receipt.network_ready !== (value.receipt.status === 'ready')
      || value.receipt.execution_ready !== false || !/^[0-9a-f]{64}$/.test(value.receipt.request_digest)
      || (value.receipt.proof !== null) !== value.receipt.network_ready
      || value.receipt.proof && value.receipt.proof.request_digest !== value.receipt.request_digest)) throw new Error('The environment network response could not be verified.')
  state.value = value; emit('changed', value.preparation_available)
}
async function request(action = '') {
  if (busy.value) return
  const current = ++generation
  controller?.abort(); controller = new AbortController(); loading.value = true; error.value = ''; emit('changed', false)
  try {
    const value = await backendRequest<Status>(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/foundation/networks${action ? '/'+action : ''}`,
      {...(action ? {method: 'POST', body: '{}'} : {}), signal: controller.signal})
    if (current === generation) accept(value)
  } catch (cause) {if (current === generation) error.value = cause instanceof Error ? cause.message : 'Environment network status could not be verified.'}
  finally {if (current === generation) loading.value = false}
}
</script>

<template>
  <section :aria-labelledby="heading" class="mb-4 space-y-3 rounded border border-base-300 p-4" data-testid="environment-network-preparation">
    <h3 :id="heading" class="font-semibold">Environment bridges</h3>
    <p class="text-sm">The registered environment owns its isolated bridge pool and gateway management network. Each run owns its gateway and participant VMs.</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="environment-network-load" :disabled="busy" @click="request()">Load bridge preparation status</button>
    <p v-if="loading" role="status" class="text-sm">Verifying original environment network ownership…</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="state?.issue" role="status" class="text-sm">{{ state.issue }}</p>
    <button v-if="state && !state.request_recorded" type="button" class="btn btn-outline btn-sm" data-testid="environment-network-review" :disabled="busy" @click="request('review')">Review and retain bridge request</button>
    <template v-if="state?.plan">
      <p class="text-sm">Management: {{ state.plan.management.bridge }} · {{ state.plan.management.subnet }}</p>
      <details class="rounded border border-base-300 p-3">
        <summary class="cursor-pointer text-sm">Isolated environment pool ({{ state.plan.networks.length }} bridges)</summary>
        <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-2"><li v-for="network in state.plan.networks" :key="network.bridge">{{ network.bridge }} · {{ network.subnet }}</li></ul>
      </details>
    </template>
    <p v-if="state?.preparation_available && !state.receipt?.network_ready" role="status" class="text-sm">Run or resume the full deployment action to prepare its templates and bridges. The node verifies the firewall before activating any bridge.</p>
    <p v-if="state?.receipt?.network_ready" role="status" class="text-sm">Bridge preparation verified. Gateway and participant deployment still need their own checks.</p>
    <button v-if="state?.request_recorded" type="button" class="btn btn-outline btn-sm" data-testid="environment-network-reconcile" :disabled="busy" @click="request('reconcile')">Refresh bridge status from node</button>
    <p class="text-xs text-base-content/70">This optional module has no Keycloak or Headscale dependency. Public egress stays closed until a run receives its own reviewed lease.</p>
  </section>
</template>

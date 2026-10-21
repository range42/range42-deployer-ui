<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface Progress {vm_id: number; phase: string}
interface Status {deployment_id: string; request_recorded: boolean; preparation_available: boolean;
  receipt: null | {status: string; foundation_ready: boolean; templates: Progress[]};
  issue: string; execution_ready: false; infrastructure_qualified: false}
const props = defineProps<{deploymentId: string; templateIds: number[]; disabled?: boolean}>()
const emit = defineEmits<{changed: [available: boolean]}>()
const backend = useBackendApiStore(), heading = useId()
const state = ref<Status | null>(null), loading = ref(false), error = ref('')
const busy = computed(() => loading.value || !!props.disabled)
let generation = 0, controller: AbortController | null = null
const phases: Record<string, string> = {pending: 'Pending', clone_intent: 'Clone dispatch retained', cloning: 'Copying',
  cloned: 'Original copy recorded', seal_intent: 'Sealing request retained', sealed: 'Network and login data removed',
  template_intent: 'Template conversion retained', templating: 'Converting to template', complete: 'Prepared'}
function invalidate() {
  generation++; controller?.abort(); state.value = null; error.value = ''; loading.value = false; emit('changed', false)
}
watch([() => props.deploymentId, () => props.templateIds.join(','), () => props.disabled,
  getBackendScope, () => backend.token], invalidate)
onBeforeUnmount(() => {generation++; controller?.abort()})
function accept(value: Status) {
  if (!value || value.deployment_id !== props.deploymentId || typeof value.request_recorded !== 'boolean'
      || typeof value.preparation_available !== 'boolean' || typeof value.issue !== 'string'
      || value.execution_ready !== false || value.infrastructure_qualified !== false
      || value.preparation_available && !value.request_recorded) throw new Error('The foundation response could not be verified.')
  if (value.receipt) {
    const receipt = value.receipt
    if (!value.request_recorded || !['absent', 'preparing', 'uncertain', 'complete'].includes(receipt.status)
        || !Array.isArray(receipt.templates) || receipt.templates.length !== 2
        || new Set(receipt.templates.map(row => row.vm_id)).size !== 2
        || JSON.stringify(receipt.templates.map(row => row.vm_id).sort((a, b) => a-b)) !== JSON.stringify([...props.templateIds].sort((a, b) => a-b))
        || receipt.templates.some(row => !Object.hasOwn(phases, row.phase))
        || typeof receipt.foundation_ready !== 'boolean'
        || receipt.foundation_ready !== receipt.templates.every(row => row.phase === 'complete')
        || receipt.foundation_ready !== (receipt.status === 'complete')) throw new Error('The foundation response could not be verified.')
  }
  state.value = value
  emit('changed', value.preparation_available && value.receipt?.status !== 'uncertain')
}
async function request(action = '') {
  if (busy.value) return
  const current = ++generation
  controller?.abort(); controller = new AbortController(); loading.value = true; error.value = ''; emit('changed', false)
  try {
    const value = await backendRequest<Status>(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/foundation${action ? '/'+action : ''}`,
      {...(action ? {method: 'POST', body: '{}'} : {}), signal: controller.signal})
    if (current === generation) accept(value)
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : 'Foundation status could not be verified.' }
  finally { if (current === generation) loading.value = false }
}
</script>

<template>
  <section :aria-labelledby="heading" class="mb-4 space-y-3 rounded border border-base-300 p-4" data-testid="foundation-execution">
    <h3 :id="heading" class="font-semibold">Reusable template preparation</h3>
    <p class="text-sm">This deployment owns its two reusable template copies. Bridges and run gateways are managed separately; their qualification remains required before participant deployment.</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="foundation-status-refresh" :disabled="busy" @click="request()">Load preparation status</button>
    <p v-if="loading" role="status">Verifying the retained preparation request…</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="state?.issue" role="status" class="text-sm">{{ state.issue }}</p>
    <button v-if="state && !state.request_recorded" type="button" class="btn btn-outline btn-sm" data-testid="foundation-request-review" :disabled="busy" @click="request('review')">Review and retain preparation request</button>
    <p v-if="state?.preparation_available && !state.receipt?.foundation_ready && state.receipt?.status !== 'uncertain'" role="status" class="text-sm">Apply or resume the full deployment action to prepare the original copies. Starting it verifies the node and source templates again.</p>
    <p v-if="state?.receipt?.status === 'uncertain'" role="alert" class="text-sm text-warning">Clone outcome is uncertain. Preserve this request and its capacity. An administrator must reconcile the original native task before preparation can continue.</p>
    <p v-if="state?.receipt?.foundation_ready" role="status" class="text-sm">Prepared copies recorded. Refresh node status to verify their current generations.</p>
    <ul v-if="state?.receipt" class="text-sm space-y-1"><li v-for="copy in state.receipt.templates" :key="copy.vm_id">VM {{ copy.vm_id }} · {{ phases[copy.phase] }}</li></ul>
    <button v-if="state?.request_recorded" type="button" class="btn btn-outline btn-sm" data-testid="foundation-node-refresh" :disabled="busy" @click="request('reconcile')">Refresh node status</button>
  </section>
</template>

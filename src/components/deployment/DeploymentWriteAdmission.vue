<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useDialogKeyboard } from '@/composables/useDialogKeyboard'

interface State {
  scope: 'managed_deployment_writers'; deployment_id: string; available: boolean;
  state: 'open' | 'closed' | 'draining'; revision: number; pause_id: string | null;
  vm_ids: number[]; active_attempts: number; held_workspace_locks: number; active_snapshot_operations: number;
  changed_by: string | null; changed_at: string | null;
  remote_quiescence_verified: false; capacity_borrowing_allowed: false;
}
const props = defineProps<{deploymentId: string; disabled?: boolean}>()
const emit = defineEmits<{changed: [closed: boolean]}>()
const backend = useBackendApiStore()
const state = ref<State | null>(null), loading = ref(false), sending = ref(false), role = ref('')
const error = ref(''), confirming = ref(false), confirmation = ref(''), dialog = ref<HTMLElement | null>(null)
const keyboard = useDialogKeyboard(() => confirming.value, dialog, () => {if (!sending.value) confirming.value = false})
const busy = computed(() => loading.value || sending.value || !!props.disabled)
let generation = 0, controller: AbortController | null = null
const url = () => `/v1/deployments/${encodeURIComponent(props.deploymentId)}/write-admission`
function reset() {
  generation++; controller?.abort(); controller = null
  state.value = null; loading.value = false; sending.value = false; role.value = ''
  error.value = ''; confirming.value = false; confirmation.value = ''
  emit('changed', false)
}
watch(() => [props.deploymentId, backend.activeHost?.id, getBackendScope(), backend.token], reset, {flush:'sync'})
onBeforeUnmount(() => {generation++;controller?.abort()})
function accept(value: State) {
  const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0
  if (!value || value.scope !== 'managed_deployment_writers' || value.deployment_id !== props.deploymentId
      || !['open','closed','draining'].includes(value.state) || typeof value.available !== 'boolean'
      || !nonnegative(value.revision) || !nonnegative(value.active_attempts) || !nonnegative(value.held_workspace_locks) || !nonnegative(value.active_snapshot_operations)
      || !Array.isArray(value.vm_ids) || value.vm_ids.some(id => !Number.isSafeInteger(id) || id < 100 || id > 999999999)
      || new Set(value.vm_ids).size !== value.vm_ids.length || (value.available && !value.vm_ids.length)
      || (value.state !== 'open' && (!value.available || !value.pause_id || !/^[a-f0-9]{32}$/.test(value.pause_id)))
      || value.remote_quiescence_verified !== false || value.capacity_borrowing_allowed !== false) {
    throw new Error('The deployment admission response could not be verified. Refresh before continuing.')
  }
  state.value = value
  emit('changed', value.state !== 'open')
}
async function refresh() {
  if (busy.value) return
  const current = generation
  confirming.value = false; confirmation.value = ''; state.value = null; error.value = ''; role.value = ''
  loading.value = true; controller = new AbortController()
  try {
    const identity = await backendRequest<{role: string}>('/v1/auth/me', {signal:controller.signal})
    if (current !== generation) return
    role.value = identity.role
    const value = await backendRequest<State>(url(), {signal:controller.signal})
    if (current === generation) accept(value)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? cause.message : 'Could not read deployment write admission.'
  } finally {if (current === generation) loading.value = false}
}
async function change(action: 'pause' | 'resume') {
  const proof = state.value
  if (busy.value || role.value !== 'admin' || !proof?.available
      || (action === 'pause' ? proof.state !== 'open' : proof.state !== 'closed' || confirmation.value !== 'RESUME')) return
  const current = generation
  sending.value = true; error.value = ''; controller = new AbortController()
  try {
    const value = await backendRequest<State>(url(), {method:'POST', signal:controller.signal, body:JSON.stringify({
      action, expected_revision:proof.revision, request_id:crypto.randomUUID().replaceAll('-',''),
      ...(action === 'resume' ? {pause_id:proof.pause_id, confirmation:'RESUME'} : {}),
    })})
    if (current === generation) {accept(value);confirming.value = false;confirmation.value = ''}
  } catch (cause) {
    if (current !== generation) return
    error.value = cause instanceof Error ? cause.message : 'Could not confirm the admission change.'
    confirming.value = false; confirmation.value = ''; state.value = null
    // The write may have committed. Recover only through a new read; never replay.
    emit('changed', true)
    try {
      const value = await backendRequest<State>(url(), {signal:controller.signal})
      if (current === generation) accept(value)
    } catch { /* Remain visibly uncertain; no controls or automatic resume. */ }
  } finally {if (current === generation) sending.value = false}
}
</script>

<template>
  <section class="rounded border border-base-300 p-4 mb-4 space-y-3" aria-labelledby="deployment-write-admission-title">
    <h2 id="deployment-write-admission-title" class="font-semibold">Deployment maintenance access</h2>
    <p class="text-sm">Pause deployment actions and direct VM power, configuration and snapshot changes for this run’s owned VMs. Other runs remain available through the scoped API. Older administrative writes are paused across this backend because they have no run scope.</p>
    <p class="text-sm">Closing access does not prove that remote tasks have finished or release RAM or storage. Participant account and VPN operations have separate controls.</p>
    <button type="button" class="btn btn-sm" data-testid="write-admission-refresh" :disabled="busy" @click="refresh">{{ state ? 'Refresh maintenance access' : 'Review maintenance access' }}</button>
    <template v-if="state">
      <p role="status">{{ state.state === 'open' ? 'Open · accepting managed writes' : state.state === 'draining' ? 'Closed · accepted local operations remain' : 'Closed · new managed writes are paused' }} · {{ state.active_attempts }} accepted attempts · {{ state.held_workspace_locks }} workspace locks · {{ state.active_snapshot_operations }} unresolved snapshot operations</p>
      <p v-if="!state.available" role="status">No retained allocation is available for this deployment. Preserve or restore its owned assignments before maintenance.</p>
      <template v-else>
        <p class="text-sm break-words">Owned VM IDs: {{ state.vm_ids.join(', ') }}</p>
        <p v-if="state.changed_by" class="text-sm">Last decision by {{ state.changed_by }} · revision {{ state.revision }}</p>
        <p v-if="role !== 'admin'" class="text-sm">An administrator must change maintenance access.</p>
        <button v-else-if="state.state === 'open'" type="button" class="btn btn-sm" data-testid="write-admission-pause" :disabled="busy" @click="change('pause')">Pause this run’s VM changes</button>
        <button v-else-if="state.state === 'closed'" type="button" class="btn btn-sm" data-testid="write-admission-resume" :disabled="busy" @click="confirming = true; confirmation = ''">Resume this run’s VM changes</button>
      </template>
    </template>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <div v-if="confirming" class="modal modal-open" @keydown="keyboard">
      <form ref="dialog" role="dialog" aria-modal="true" aria-labelledby="deployment-write-resume-title" tabindex="-1" class="modal-box space-y-4" @submit.prevent="change('resume')">
        <h3 id="deployment-write-resume-title" class="text-lg font-semibold">Resume this run’s VM changes?</h3>
        <p>Confirm that maintenance is complete and the run is ready to accept managed VM changes again.</p>
        <label class="form-control gap-2"><span>Type RESUME to continue</span><input v-model="confirmation" class="input input-bordered" autocomplete="off" spellcheck="false" /></label>
        <div class="modal-action"><button type="button" class="btn" :disabled="sending" @click="confirming = false">Cancel</button>
          <button type="submit" class="btn btn-primary" data-testid="write-admission-confirm" :disabled="busy || confirmation !== 'RESUME'">Resume VM changes</button></div>
      </form>
    </div>
  </section>
</template>

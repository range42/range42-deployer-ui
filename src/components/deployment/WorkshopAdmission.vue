<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useDialogKeyboard } from '@/composables/useDialogKeyboard'

export interface Admission {
  scope: 'legacy_controller_queue'; state: 'open' | 'draining' | 'paused'; revision: number;
  pause_id: string | null; queued_count: number; running_count: number;
}
const props = defineProps<{ admission?: Admission | null; disabled?: boolean }>()
const backend = useBackendApiStore()
const emit = defineEmits<{ changed: [] }>()
const sending = ref(false), error = ref(''), confirming = ref(false), confirmation = ref('')
const dialog = ref<HTMLElement | null>(null)
const keyboard = useDialogKeyboard(() => confirming.value, dialog, () => { if (!sending.value) confirming.value = false })
let epoch = 0
watch(() => [getBackendScope(), backend.token, props.admission?.revision, props.admission?.pause_id], () => {
  epoch++; confirming.value = false; confirmation.value = ''; sending.value = false; error.value = ''
})
async function change(action: 'pause' | 'resume') {
  const state = props.admission
  if (!state || sending.value || props.disabled ||
      (action === 'pause' ? state.state !== 'open' : state.state !== 'paused' || !state.pause_id || confirmation.value !== 'RESUME')) return
  const current = epoch
  const request = { action, expected_revision: state.revision, request_id: crypto.randomUUID().replaceAll('-', ''),
    ...(action === 'resume' ? { pause_id: state.pause_id, confirmation: 'RESUME' } : {}) }
  sending.value = true; error.value = ''
  try {
    await backendRequest('/v1/admin/workshop/admission', { method: 'POST', body: JSON.stringify(request) })
    if (current === epoch) confirming.value = false
  } catch (cause) {
    if (current === epoch) error.value = cause instanceof Error ? cause.message : 'Could not confirm the admission change.'
  } finally {
    if (current === epoch) {
      sending.value = false
      // The server may have committed despite a lost response. Refresh before
      // another deliberate request; never retry a pause/resume automatically.
      emit('changed')
    }
  }
}
onBeforeUnmount(() => { epoch++ })
</script>

<template>
  <section class="rounded border border-base-300 p-4 space-y-3" aria-labelledby="workshop-admission-title">
    <h3 id="workshop-admission-title" class="font-semibold">Participant-management operations</h3>
    <p class="text-sm">Pause new participant-management jobs and let accepted jobs finish. Emergency access revocation remains available. VM power controls and deployment actions have their own controls.</p>
    <p v-if="!admission" role="status">Durable pause is not installed on this controller.</p>
    <template v-else>
      <p role="status">{{ admission.state === 'open' ? 'Accepting jobs' : admission.state === 'draining' ? 'Paused · finishing accepted jobs' : 'Paused · queue is idle' }} · {{ admission.queued_count }} queued · {{ admission.running_count }} running</p>
      <button v-if="admission.state === 'open'" type="button" class="btn btn-sm" data-testid="workshop-pause" :disabled="disabled || sending" @click="change('pause')">Pause participant management</button>
      <button v-else-if="admission.state === 'paused'" type="button" class="btn btn-sm" data-testid="workshop-resume" :disabled="disabled || sending" @click="confirming = true; confirmation = ''">Resume participant management</button>
    </template>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <div v-if="confirming" class="modal modal-open" @keydown="keyboard">
      <form ref="dialog" role="dialog" aria-modal="true" aria-labelledby="workshop-resume-title" tabindex="-1" class="modal-box space-y-4" @submit.prevent="change('resume')">
        <h3 id="workshop-resume-title" class="text-lg font-semibold">Resume participant management?</h3>
        <p>Confirm that maintenance is complete before accepting new participant changes.</p>
        <label class="form-control gap-2"><span>Type RESUME to continue</span><input v-model="confirmation" class="input input-bordered" autocomplete="off" spellcheck="false" /></label>
        <div class="modal-action"><button type="button" class="btn" :disabled="sending" @click="confirming = false">Cancel</button>
          <button type="submit" class="btn btn-primary" data-testid="workshop-resume-confirm" :disabled="sending || disabled || confirmation !== 'RESUME'">Resume participant management</button></div>
      </form>
    </div>
  </section>
</template>

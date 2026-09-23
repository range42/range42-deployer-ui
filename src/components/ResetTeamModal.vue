<script setup>
/**
 * <ResetTeamModal> — Plan C §C4.9
 *
 * Per-team reset confirmation with queued-behind-in-flight semantics.
 *
 * When the parent deployment is currently `deploying` / `running_attempt`,
 * the modal switches its primary action to "Queue reset" and POSTs the
 * reset with `queue=true` so the backend enqueues it rather than running
 * immediately. On success the caller receives the `queued` event and can
 * surface a "Queued" pill on the team card; when the in-flight attempt
 * later fails the caller may prompt the operator to run the queued reset.
 *
 * Endpoint: POST /v1/deployments/:id/teams/:n/reset[?queue=true]
 *
 * Props:
 *   visible      — open state
 *   deploymentId — deployment id
 *   teamId       — team identifier (the :n segment)
 *   inFlight     — whether the deployment is currently in-flight
 *
 * Emits:
 *   close
 *   reset(teamId)   — after an immediate successful reset
 *   queued(teamId)  — after a queued reset
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  visible: { type: Boolean, default: false },
  deploymentId: { type: String, required: true },
  teamId: { type: String, required: true },
  inFlight: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'reset', 'queued'])
const { t } = useI18n({ useScope: 'global' })

const submitting = ref(false)
const submitError = ref(null)

const isQueued = computed(() => !!props.inFlight)
const title = computed(() => t('deployment.reset.title', { id: props.teamId }))

async function onConfirm() {
  if (submitting.value) return
  submitting.value = true
  submitError.value = null
  try {
    const base = `/v1/deployments/${encodeURIComponent(props.deploymentId)}/teams/${encodeURIComponent(props.teamId)}/reset`
    const url = isQueued.value ? `${base}?queue=true` : base
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: props.teamId }),
    })
    if (!res.ok) {
      submitError.value = `HTTP ${res.status}`
      return
    }
    if (isQueued.value) emit('queued', { teamId: props.teamId })
    else emit('reset', { teamId: props.teamId })
    emit('close')
  } catch (err) {
    submitError.value = err?.message || String(err)
  } finally {
    submitting.value = false
  }
}

function onCancel() { emit('close') }

watch(() => props.visible, (v) => {
  if (v) submitError.value = null
})
</script>

<template>
  <div
    v-if="visible"
    class="modal modal-open z-[110]"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="reset-title"
    data-testid="reset-modal"
  >
    <div class="modal-box max-w-md">
      <h2 id="reset-title" class="text-lg font-bold">{{ title }}</h2>
      <p class="py-2 text-sm text-base-content/70">
        {{ t('deployment.reset.body', { id: teamId }) }}
      </p>
      <p v-if="isQueued" class="text-xs text-warning mt-1" data-testid="reset-queue-notice">
        {{ t('deployment.reset.queuedNotice') }}
      </p>
      <p v-if="submitError" class="text-xs text-error mt-2">{{ submitError }}</p>
      <div class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="reset-cancel"
          @click="onCancel"
        >{{ t('deployment.reset.cancel') }}</button>
        <button
          type="button"
          class="btn btn-sm"
          :class="isQueued ? 'btn-warning' : 'btn-primary'"
          data-testid="reset-confirm"
          :disabled="submitting"
          @click="onConfirm"
        >
          <span v-if="isQueued">{{ t('deployment.reset.confirmQueue') }}</span>
          <span v-else>{{ t('deployment.reset.confirm') }}</span>
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-base-300/80" aria-hidden="true" @click="onCancel"></div>
  </div>
</template>

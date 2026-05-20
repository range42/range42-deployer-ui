<script setup>
/**
 * <RollbackModal> — Plan C §C4.10
 *
 * Lets the operator pick a team-scoped snapshot and roll back via
 *   POST /v1/deployments/:id/rollback
 *   { scope: 'team', team_id, snapshot_name, partial? }
 *
 * If the backend returns 409 with `details[]` signalling some VM snapshots
 * are missing (retention expired or never captured), the modal surfaces
 * the list and offers a partial-rollback button per spec §18.6.
 *
 * Props:
 *   visible      — open state
 *   deploymentId — parent deployment id
 *   teamId       — team identifier
 *   snapshots    — { name, created_at }[]
 *
 * Emits:
 *   close
 *   rolled-back(payload)
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  visible: { type: Boolean, default: false },
  deploymentId: { type: String, required: true },
  teamId: { type: String, required: true },
  snapshots: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'rolled-back'])
const { t } = useI18n({ useScope: 'global' })

const selected = ref('')
const submitting = ref(false)
const submitError = ref(null)
const missingDetails = ref([])
const hasEmpty = computed(() => !props.snapshots || props.snapshots.length === 0)
const canConfirm = computed(() => !!selected.value && !submitting.value && !hasEmpty.value)

async function postRollback(partial = false) {
  submitting.value = true
  submitError.value = null
  try {
    const res = await fetch(
      `/v1/deployments/${encodeURIComponent(props.deploymentId)}/rollback`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'team',
          team_id: props.teamId,
          snapshot_name: selected.value,
          ...(partial ? { partial: true } : {}),
        }),
      },
    )
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}))
      missingDetails.value = Array.isArray(body?.details) ? body.details : []
      return
    }
    if (!res.ok) {
      submitError.value = `${t('deployment.rollback.error')} (HTTP ${res.status})`
      return
    }
    const body = await res.json().catch(() => ({}))
    emit('rolled-back', { ...body, partial })
    emit('close')
  } catch (err) {
    submitError.value = err?.message || String(err)
  } finally {
    submitting.value = false
  }
}

function onConfirm() {
  if (!canConfirm.value) return
  postRollback(false)
}

function onPartial() {
  postRollback(true)
}

function onCancel() { emit('close') }

watch(() => props.visible, (v) => {
  if (v) {
    selected.value = props.snapshots?.[0]?.name || ''
    missingDetails.value = []
    submitError.value = null
  }
})
</script>

<template>
  <div
    v-if="visible"
    class="modal modal-open z-[110]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="rollback-title"
    data-testid="rollback-modal"
  >
    <div class="modal-box max-w-md">
      <h2 id="rollback-title" class="text-lg font-bold">
        {{ t('deployment.rollback.title', { id: teamId }) }}
      </h2>

      <div v-if="hasEmpty" class="py-4 text-sm italic text-base-content/70" data-testid="rollback-empty">
        {{ t('deployment.rollback.noSnapshots') }}
      </div>

      <div v-else class="form-control mt-3">
        <label class="label pb-1">
          <span class="label-text font-medium">{{ t('deployment.rollback.chooseSnapshot') }}</span>
        </label>
        <select
          v-model="selected"
          class="select select-bordered select-sm"
          data-testid="rollback-select"
        >
          <option v-for="s in snapshots" :key="s.name" :value="s.name">
            {{ s.name }}<span v-if="s.created_at"> — {{ s.created_at }}</span>
          </option>
        </select>
      </div>

      <div v-if="missingDetails.length > 0" class="mt-3 rounded border border-error/40 bg-error/10 p-2" data-testid="rollback-missing">
        <h3 class="text-sm font-semibold text-error">{{ t('deployment.rollback.missingHeader') }}</h3>
        <ul class="list-disc pl-5 text-xs mt-1 font-mono">
          <li v-for="(d, i) in missingDetails" :key="i">
            <span>VM {{ d.vm_id }}</span>
            <span v-if="d.snapshot"> · {{ d.snapshot }}</span>
            <span v-if="d.reason"> · {{ d.reason }}</span>
          </li>
        </ul>
        <button
          type="button"
          class="btn btn-sm btn-warning mt-2"
          data-testid="rollback-partial"
          :disabled="submitting"
          @click="onPartial"
        >{{ t('deployment.rollback.partial') }}</button>
      </div>

      <p v-if="submitError" class="text-xs text-error mt-2">{{ submitError }}</p>

      <div class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="rollback-cancel"
          @click="onCancel"
        >{{ t('deployment.rollback.cancel') }}</button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-testid="rollback-confirm"
          :disabled="!canConfirm"
          @click="onConfirm"
        >{{ t('deployment.rollback.confirm') }}</button>
      </div>
    </div>
    <div class="modal-backdrop bg-base-300/80" aria-hidden="true" @click="onCancel"></div>
  </div>
</template>

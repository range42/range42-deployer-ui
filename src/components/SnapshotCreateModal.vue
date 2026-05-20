<script setup>
/**
 * <SnapshotCreateModal> — Plan C §C4.10
 *
 * Creates a team-scoped Proxmox snapshot via
 *   POST /v1/deployments/:id/snapshot
 *   { scope: 'team', team_id, name }
 *
 * Props:
 *   visible      — open state
 *   deploymentId — parent deployment id
 *   teamId       — team identifier
 *
 * Emits:
 *   close
 *   created(snapshot)
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  visible: { type: Boolean, default: false },
  deploymentId: { type: String, required: true },
  teamId: { type: String, required: true },
})

const emit = defineEmits(['close', 'created'])
const { t } = useI18n({ useScope: 'global' })

const name = ref('')
const submitting = ref(false)
const submitError = ref(null)
const inputRef = ref(null)

const canCreate = computed(() => name.value.trim().length > 0 && !submitting.value)

async function onCreate() {
  if (!canCreate.value) return
  submitting.value = true
  submitError.value = null
  try {
    const res = await fetch(
      `/v1/deployments/${encodeURIComponent(props.deploymentId)}/snapshot`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'team',
          team_id: props.teamId,
          name: name.value.trim(),
        }),
      },
    )
    if (!res.ok) {
      submitError.value = `${t('deployment.snapshot.error')} (HTTP ${res.status})`
      return
    }
    const body = await res.json().catch(() => ({}))
    emit('created', body)
    emit('close')
  } catch (err) {
    submitError.value = err?.message || String(err)
  } finally {
    submitting.value = false
  }
}

function onCancel() { emit('close') }

watch(() => props.visible, async (v) => {
  if (v) {
    name.value = ''
    submitError.value = null
    await nextTick()
    inputRef.value?.focus()
  }
})
</script>

<template>
  <div
    v-if="visible"
    class="modal modal-open z-[110]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="snapshot-title"
    data-testid="snapshot-modal"
  >
    <div class="modal-box max-w-md">
      <h2 id="snapshot-title" class="text-lg font-bold">
        {{ t('deployment.snapshot.title', { id: teamId }) }}
      </h2>
      <div class="form-control mt-3" data-testid="snapshot-name">
        <label class="label pb-1">
          <span class="label-text font-medium">{{ t('deployment.snapshot.name') }}</span>
        </label>
        <input
          ref="inputRef"
          v-model="name"
          type="text"
          class="input input-bordered input-sm"
          :placeholder="t('deployment.snapshot.namePlaceholder')"
          @keyup.enter="onCreate"
        />
      </div>
      <p v-if="submitError" class="text-xs text-error mt-2">{{ submitError }}</p>
      <div class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="snapshot-cancel"
          @click="onCancel"
        >{{ t('deployment.snapshot.cancel') }}</button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-testid="snapshot-create"
          :disabled="!canCreate"
          @click="onCreate"
        >{{ t('deployment.snapshot.create') }}</button>
      </div>
    </div>
    <div class="modal-backdrop bg-base-300/80" aria-hidden="true" @click="onCancel"></div>
  </div>
</template>

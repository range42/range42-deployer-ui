<script setup>
/**
 * <TeardownConfirmModal> — Plan C §C4.8
 *
 * Confirm-phrase teardown modal. The operator must type the deployment's
 * codename exactly to enable the destroy button. On confirm, the modal
 * POSTs `DELETE /v1/deployments/:id` with `{confirm: "<codename>"}` in the
 * body and navigates to the /deployments list.
 *
 * Teardown progress continues to stream on the same SSE feed subscribed by
 * the parent view — this modal only kicks off the call.
 *
 * Props:
 *   visible        — open state
 *   deploymentId   — the id of the deployment to tear down
 *   codename       — the required confirmation phrase
 *
 * Emits:
 *   close          — dismiss
 *   destroyed(id)  — after successful DELETE
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  visible: { type: Boolean, default: false },
  deploymentId: { type: String, required: true },
  codename: { type: String, required: true },
})

const emit = defineEmits(['close', 'destroyed'])
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })

const typed = ref('')
const destroying = ref(false)
const destroyError = ref(null)
const inputRef = ref(null)

const matches = computed(() => typed.value === props.codename && !!props.codename)
const canDestroy = computed(() => matches.value && !destroying.value)
const mismatch = computed(() => typed.value.length > 0 && !matches.value)

function onCancel() {
  emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

async function onDestroy() {
  if (!canDestroy.value) return
  destroying.value = true
  destroyError.value = null
  try {
    const res = await fetch(`/v1/deployments/${encodeURIComponent(props.deploymentId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: props.codename }),
    })
    if (!res.ok) {
      destroyError.value = `${t('deployment.teardown.error')} (HTTP ${res.status})`
      return
    }
    emit('destroyed', props.deploymentId)
    emit('close')
    router.push({ name: 'deployments' })
  } catch (err) {
    destroyError.value = err?.message || String(err)
  } finally {
    destroying.value = false
  }
}

watch(() => props.visible, async (v) => {
  if (v) {
    typed.value = ''
    destroyError.value = null
    await nextTick()
    inputRef.value?.focus()
  }
})
</script>

<template>
  <div
    v-if="visible"
    class="modal modal-open z-[120]"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="teardown-title"
    aria-describedby="teardown-body"
    data-testid="teardown-modal"
    @keydown="onKeydown"
  >
    <div class="modal-box max-w-md">
      <h2 id="teardown-title" class="text-lg font-bold flex items-center gap-2">
        <svg class="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        {{ t('deployment.teardown.title') }}
      </h2>

      <p id="teardown-body" class="py-2 text-sm text-base-content/70">
        {{ t('deployment.teardown.confirmLabel', { codename: codename }) }}
      </p>

      <div class="form-control mt-2">
        <input
          ref="inputRef"
          v-model="typed"
          type="text"
          class="input input-bordered input-sm"
          :placeholder="t('deployment.teardown.inputPlaceholder')"
          autocomplete="off"
          spellcheck="false"
          data-testid="teardown-input"
          :aria-invalid="mismatch ? 'true' : 'false'"
        />
        <p v-if="mismatch" class="text-xs text-error mt-1" data-testid="teardown-mismatch">
          {{ t('deployment.teardown.mismatch') }}
        </p>
      </div>

      <p v-if="destroyError" class="text-xs text-error mt-2" data-testid="teardown-error">
        {{ destroyError }}
      </p>

      <div class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="teardown-cancel"
          @click="onCancel"
        >{{ t('deployment.teardown.cancel') }}</button>
        <button
          type="button"
          class="btn btn-sm btn-error"
          data-testid="teardown-destroy"
          :disabled="!canDestroy"
          @click="onDestroy"
        >
          <span v-if="destroying">{{ t('deployment.teardown.destroying') }}</span>
          <span v-else>{{ t('deployment.teardown.destroy') }}</span>
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-base-300/80" aria-hidden="true" @click="onCancel"></div>
  </div>
</template>

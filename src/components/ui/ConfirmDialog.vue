<script setup>
import { nextTick, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

const {
  visible,
  title,
  message,
  confirmText,
  cancelText,
  confirmClass,
  resolve,
} = useConfirmDialog()

// Track focus before opening so we can restore it on close.
const opener = ref(null)
const confirmBtn = ref(null)

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    resolve(false)
  }
}

function close(accepted) {
  resolve(accepted)
}

watch(
  visible,
  async (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
      // Capture current focus owner and focus the confirm button after paint.
      if (typeof document !== 'undefined') {
        opener.value = document.activeElement
      }
      await nextTick()
      confirmBtn.value?.focus()
    } else if (!isOpen && wasOpen) {
      // Return focus to the original opener.
      const target = opener.value
      opener.value = null
      if (target && typeof target.focus === 'function') {
        target.focus()
      }
    }
  },
  { immediate: false },
)
</script>

<template>
  <Teleport to="body">
    <FocusTrap v-if="visible" :active="visible" :initial-focus="() => confirmBtn">
      <div
        class="modal modal-open z-[1000]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        @keydown="onKeydown"
      >
        <div class="modal-box max-w-md">
          <h3 id="confirm-title" class="text-lg font-bold flex items-center gap-2">
            <svg class="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            {{ title }}
          </h3>
          <p id="confirm-body" class="py-4 text-base-content/70 whitespace-pre-line">{{ message }}</p>
          <div class="modal-action">
            <button class="btn btn-ghost" type="button" @click="close(false)">
              {{ cancelText }}
            </button>
            <button
              ref="confirmBtn"
              class="btn"
              type="button"
              :class="confirmClass"
              @click="close(true)"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
        <div
          class="modal-backdrop bg-base-300/80"
          aria-hidden="true"
          @click="close(false)"
        ></div>
      </div>
    </FocusTrap>
  </Teleport>
</template>

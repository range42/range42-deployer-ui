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
      if (visible.value) confirmBtn.value?.focus()
    } else if (!isOpen && wasOpen) {
      // Let FocusTrap unmount before returning focus outside its container.
      const target = opener.value
      opener.value = null
      await nextTick()
      if (!visible.value && target?.isConnected && typeof target.focus === 'function') {
        target.focus()
      }
    }
  },
  { immediate: false },
)
</script>

<template>
  <Teleport to="body">
    <!-- Vue owns visibility. DaisyUI's modal starting-style hides new content
         during trap activation and leaves it without any tabbable controls. -->
    <FocusTrap v-if="visible" :active="visible" :initial-focus="() => confirmBtn" :return-focus-on-deactivate="false">
      <div
        class="fixed inset-0 z-[1000] grid place-items-center overflow-y-auto bg-base-300/80 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        @keydown="onKeydown"
        @click.self="close(false)"
      >
        <div class="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-box bg-base-100 p-6 shadow-xl">
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
      </div>
    </FocusTrap>
  </Teleport>
</template>

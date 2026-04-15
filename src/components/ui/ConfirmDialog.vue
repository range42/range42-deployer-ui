<script setup>
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
</script>

<template>
  <div v-if="visible" class="modal modal-open z-[100]">
    <div class="modal-box max-w-md">
      <h3 class="text-lg font-bold flex items-center gap-2">
        <svg class="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        {{ title }}
      </h3>
      <p class="py-4 text-base-content/70 whitespace-pre-line">{{ message }}</p>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="resolve(false)">
          {{ cancelText }}
        </button>
        <button class="btn" :class="confirmClass" @click="resolve(true)">
          {{ confirmText }}
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-base-300/80" @click="resolve(false)"></div>
  </div>
</template>

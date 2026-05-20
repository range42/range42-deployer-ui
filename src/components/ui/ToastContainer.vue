<script setup>
import { useToast } from '@/composables/useToast'

const { toasts, removeToast, pauseToast, resumeToast } = useToast()

const alertClass = (type) => {
  switch (type) {
    case 'success': return 'alert-success'
    case 'warning': return 'alert-warning'
    case 'error': return 'alert-error'
    default: return 'alert-info'
  }
}
</script>

<template>
  <div
    class="toast toast-end toast-bottom z-[200]"
    role="status"
    aria-live="polite"
    aria-atomic="false"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="alert shadow-lg max-w-sm cursor-pointer toast-item"
      :class="alertClass(toast.type)"
      @click="removeToast(toast.id)"
      @mouseenter="pauseToast(toast.id)"
      @mouseleave="resumeToast(toast.id)"
    >
      <!-- Success icon -->
      <svg v-if="toast.type === 'success'" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <!-- Warning icon -->
      <svg v-else-if="toast.type === 'warning'" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
      <!-- Error icon -->
      <svg v-else-if="toast.type === 'error'" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <!-- Info icon -->
      <svg v-else class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
      <span class="text-sm">{{ toast.message }}</span>
    </div>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .toast-item {
    transition: none !important;
    animation: none !important;
  }
}
</style>

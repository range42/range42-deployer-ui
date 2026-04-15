<script setup>
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ToastContainer from '@/components/ui/ToastContainer.vue'
</script>

<template>
  <div class="h-screen bg-base-100">
    <RouterView />
  </div>
  <ConfirmDialog />
  <ToastContainer />
</template>

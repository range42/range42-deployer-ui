<script setup>
defineProps({
  label: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <div class="relative my-6">
    <div class="absolute inset-0 flex items-center">
      <div class="w-full border-t border-base-300"></div>
    </div>
    <div v-if="label || icon" class="relative flex justify-center">
      <span class="bg-base-100 px-3 text-sm text-base-content/60 flex items-center gap-1.5">
        <span v-if="icon">{{ icon }}</span>
        {{ label }}
      </span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '' },
});
</script>

<template>
  <div
    class="empty-state card card-compact bg-base-100 border border-base-200 text-center p-8"
    role="status"
  >
    <div v-if="icon" class="empty-state__icon text-4xl mb-2" aria-hidden="true">{{ icon }}</div>
    <h2 class="empty-state__title text-lg font-semibold">{{ title }}</h2>
    <p v-if="description" class="empty-state__desc text-sm text-base-content/70 mt-1">
      {{ description }}
    </p>
    <div v-if="$slots.actions" class="empty-state__actions mt-4 flex justify-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

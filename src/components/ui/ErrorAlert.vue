<script setup>
import { ref } from 'vue';

defineProps({
  title: { type: String, required: true },
  message: { type: String, default: '' },
  code: { type: String, default: '' },
  details: {
    type: Array,
    default: () => [],
  },
  traceId: { type: String, default: '' },
});

const expanded = ref(false);
</script>

<template>
  <div class="alert alert-error" role="alert">
    <div class="flex-1">
      <div class="flex items-center gap-2">
        <span class="font-semibold">{{ title }}</span>
        <span v-if="code" class="badge badge-sm">{{ code }}</span>
      </div>
      <p v-if="message" class="text-sm mt-1">{{ message }}</p>
      <p v-if="traceId" class="text-xs opacity-70 mt-1">trace: {{ traceId }}</p>
      <button
        v-if="details && details.length"
        type="button"
        class="btn btn-xs btn-ghost mt-2"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Hide details' : `Show ${details.length} detail${details.length === 1 ? '' : 's'}` }}
      </button>
      <ul v-if="expanded && details && details.length" class="mt-2 text-xs space-y-1">
        <li v-for="(d, i) in details" :key="i">
          <span class="font-mono">{{ d.field }}</span>
          <span class="opacity-80"> — {{ d.reason }}</span>
          <span v-if="d.hint" class="block opacity-60">hint: {{ d.hint }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

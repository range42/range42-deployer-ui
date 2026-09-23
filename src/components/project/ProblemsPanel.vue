<script setup>
/**
 * Problems panel — docked flat list of validation entries.
 * Click-to-jump: emits `jumpTo` with a stable descriptor the parent view
 * (ProjectEditor) can resolve to a canvas selection / config-tab navigation.
 */
import { computed } from 'vue'

const props = defineProps({
  problems: {
    type: Array,
    required: true,
  },
})

const emit = defineEmits(['jumpTo', 'close'])

const errorCount = computed(() => props.problems.filter((p) => p.severity === 'error').length)
const warningCount = computed(() => props.problems.filter((p) => p.severity === 'warning').length)

function handleClick(problem) {
  if (problem.jumpTo) emit('jumpTo', problem.jumpTo)
}

function severityClass(sev) {
  switch (sev) {
    case 'error': return 'badge-error'
    case 'warning': return 'badge-warning'
    default: return 'badge-info'
  }
}
</script>

<template>
  <section
    class="problems-panel bg-base-100 border-t border-base-300"
    role="region"
    aria-label="Problems"
    data-testid="problems-panel"
  >
    <header class="flex items-center justify-between px-4 py-2 border-b border-base-300">
      <div class="flex items-center gap-3">
        <h2 class="font-semibold text-sm">Problems</h2>
        <span
          v-if="errorCount > 0"
          class="badge badge-error badge-sm"
          data-testid="problems-error-count"
        >{{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}</span>
        <span
          v-if="warningCount > 0"
          class="badge badge-warning badge-sm"
          data-testid="problems-warning-count"
        >{{ warningCount }} warning{{ warningCount === 1 ? '' : 's' }}</span>
        <span
          v-if="problems.length === 0"
          class="text-xs opacity-60"
          data-testid="problems-empty"
        >No problems detected.</span>
      </div>
      <button class="btn btn-xs btn-ghost" @click="emit('close')" aria-label="Close problems panel">✕</button>
    </header>

    <ul v-if="problems.length" class="max-h-56 overflow-y-auto divide-y divide-base-200">
      <li
        v-for="p in problems"
        :key="p.id"
        class="problem-row px-4 py-2 flex items-start gap-3 hover:bg-base-200 cursor-pointer"
        :data-testid="`problem-row-${p.id}`"
        tabindex="0"
        @click="handleClick(p)"
        @keydown.enter="handleClick(p)"
        @keydown.space.prevent="handleClick(p)"
      >
        <span class="badge badge-sm" :class="severityClass(p.severity)">{{ p.severity }}</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm truncate">{{ p.message }}</div>
          <div class="text-[10px] opacity-60 font-mono truncate">
            {{ p.code }}
            <template v-if="p.node_id"> · node:{{ p.node_id }}</template>
            <template v-if="p.edge_id"> · edge:{{ p.edge_id }}</template>
            <template v-if="p.attachment_id"> · attachment:{{ p.attachment_id }}</template>
            <template v-if="p.file_path"> · {{ p.file_path }}<template v-if="p.line">:{{ p.line }}</template></template>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.problem-row:focus-visible {
  outline: 2px solid var(--color-primary, #3b82f6);
  outline-offset: -2px;
}
</style>

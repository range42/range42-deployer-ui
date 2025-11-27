<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps(['data', 'selected'])

const statusColor = computed(() => {
  switch (props.data.status) {
    case 'gray':
      return 'bg-gray-400'
    case 'orange':
      return 'bg-orange-400'
    case 'green':
      return 'bg-green-400'
    case 'red':
      return 'bg-red-400'
    default:
      return 'bg-gray-400'
  }
})
</script>

<template>
  <div
    class="rounded-lg shadow-md p-4 min-w-[180px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/40': true,
      'border-blue-400 shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30': selected,
      'border-blue-200 dark:border-blue-800 hover:border-blue-300 dark:hover:border-blue-700': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-lg">🐳</span>
      </div>
      <div class="text-xs bg-blue-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        Docker
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-1">
      <div class="font-semibold text-sm text-blue-900 dark:text-blue-100">
        {{ data.config?.name || 'Docker Container' }}
      </div>
      <div class="text-xs text-blue-700/80 dark:text-blue-300/70 space-y-0.5">
        <div v-if="data.config?.image" class="flex items-center gap-1">
          <span class="opacity-60">Image:</span>
          <span class="font-mono text-xs truncate max-w-[100px]">{{ data.config.image }}</span>
        </div>
        <div v-if="data.config?.ports" class="flex items-center gap-1">
          <span class="opacity-60">Ports:</span>
          <span class="font-mono text-xs">{{ data.config.ports }}</span>
        </div>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Left" class="!bg-blue-500 !border-blue-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-blue-500 !border-blue-700 !border-2" />
  </div>
</template>
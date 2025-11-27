<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps(['data', 'selected'])

const statusColor = computed(() => {
  switch (props.data.status) {
    case 'gray': return 'bg-gray-400'
    case 'orange': return 'bg-orange-400'
    case 'green': return 'bg-green-400'
    case 'red': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
})
</script>

<template>
  <div
    class="rounded-lg shadow-md p-4 min-w-[180px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/40 dark:to-purple-950/40': true,
      'border-violet-400 shadow-lg shadow-violet-200/50 dark:shadow-violet-900/30': selected,
      'border-violet-200 dark:border-violet-800 hover:border-violet-300 dark:hover:border-violet-700': !selected,
    }"
  >
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-xl">🔍</span>
      </div>
      <div class="text-xs bg-violet-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        DNS
      </div>
    </div>

    <div class="space-y-2">
      <div class="font-semibold text-sm text-violet-900 dark:text-violet-100">
        {{ data.config?.name || 'DNS Server' }}
      </div>
      <div class="text-xs text-violet-700/80 dark:text-violet-300/70 space-y-1">
        <div v-if="data.config?.zones?.length" class="flex items-center gap-1">
          <span class="opacity-60">Zones:</span>
          <span class="font-medium">{{ data.config.zones.length }}</span>
        </div>
        <div v-if="data.config?.recursion" class="inline-block">
          <span class="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded font-medium">
            Recursion
          </span>
        </div>
      </div>
    </div>

    <Handle type="target" :position="Position.Left" class="!bg-violet-500 !border-violet-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-violet-500 !border-violet-700 !border-2" />
  </div>
</template>
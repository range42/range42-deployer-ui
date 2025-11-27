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
      'bg-gradient-to-br from-cyan-50 to-sky-50 dark:from-cyan-950/40 dark:to-sky-950/40': true,
      'border-cyan-400 shadow-lg shadow-cyan-200/50 dark:shadow-cyan-900/30': selected,
      'border-cyan-200 dark:border-cyan-800 hover:border-cyan-300 dark:hover:border-cyan-700': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-xl">🔀</span>
      </div>
      <div class="text-xs bg-cyan-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        Switch
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-semibold text-sm text-cyan-900 dark:text-cyan-100">
        {{ data.config?.name || 'Network Switch' }}
      </div>
      <div class="text-xs text-cyan-700/80 dark:text-cyan-300/70 space-y-1">
        <div v-if="data.config?.portCount" class="flex items-center gap-1">
          <span class="opacity-60">Ports:</span>
          <span class="font-medium">{{ data.config.portCount }}</span>
        </div>
        <div v-if="data.config?.vlans?.length" class="flex items-center gap-1">
          <span class="opacity-60">VLANs:</span>
          <span class="font-medium">{{ data.config.vlans.length }}</span>
        </div>
        <div v-if="data.config?.spanningTreeProtocol" class="flex items-center gap-1">
          <span class="opacity-60">STP:</span>
          <span class="font-medium">{{ data.config.spanningTreeProtocol }}</span>
        </div>
      </div>
    </div>

    <!-- Connection Handles - Cyan themed -->
    <Handle type="target" :position="Position.Top" class="!bg-cyan-500 !border-cyan-700 !border-2" />
    <Handle type="source" :position="Position.Bottom" class="!bg-cyan-500 !border-cyan-700 !border-2" />
    <Handle type="source" :position="Position.Left" class="!bg-cyan-500 !border-cyan-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-cyan-500 !border-cyan-700 !border-2" />
  </div>
</template>
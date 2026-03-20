<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'

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
    class="rounded-lg shadow-md p-4 min-w-[200px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/40 dark:to-amber-950/40': true,
      'border-yellow-400 shadow-lg shadow-yellow-200/50 dark:shadow-yellow-900/30': selected,
      'border-yellow-200 dark:border-yellow-800 hover:border-yellow-300 dark:hover:border-yellow-700': !selected,
    }"
  >
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon name="balance" class="w-6 h-6" />
      </div>
      <div class="text-xs bg-yellow-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        Load Balancer
      </div>
    </div>

    <div class="space-y-2">
      <div class="font-semibold text-sm text-yellow-900 dark:text-yellow-100">
        {{ data.config?.name || 'Load Balancer' }}
      </div>
      <div class="text-xs text-yellow-700/80 dark:text-yellow-300/70 space-y-1">
        <div v-if="data.config?.algorithm" class="flex items-center gap-1">
          <span class="opacity-60">Algorithm:</span>
          <span class="font-medium">{{ data.config.algorithm }}</span>
        </div>
        <div v-if="data.config?.servers?.length" class="flex items-center gap-1">
          <span class="opacity-60">Servers:</span>
          <span class="font-medium">{{ data.config.servers.length }}</span>
        </div>
      </div>
    </div>

    <Handle type="target" :position="Position.Left" class="!bg-yellow-500 !border-yellow-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-yellow-500 !border-yellow-700 !border-2" />
  </div>
</template>
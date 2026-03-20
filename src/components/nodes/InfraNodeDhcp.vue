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
    class="rounded-lg shadow-md p-4 min-w-[180px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-lime-50 to-green-50 dark:from-lime-950/40 dark:to-green-950/40': true,
      'border-lime-400 shadow-lg shadow-lime-200/50 dark:shadow-lime-900/30': selected,
      'border-lime-200 dark:border-lime-800 hover:border-lime-300 dark:hover:border-lime-700': !selected,
    }"
  >
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon name="clipboard" class="w-6 h-6" />
      </div>
      <div class="text-xs bg-lime-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        DHCP
      </div>
    </div>

    <div class="space-y-2">
      <div class="font-semibold text-sm text-lime-900 dark:text-lime-100">
        {{ data.config?.name || 'DHCP Server' }}
      </div>
      <div class="text-xs text-lime-700/80 dark:text-lime-300/70 space-y-1">
        <div v-if="data.config?.scope" class="flex items-center gap-1">
          <span class="opacity-60">Scope:</span>
          <span class="font-mono text-xs">{{ data.config.scope }}</span>
        </div>
        <div v-if="data.config?.gateway" class="flex items-center gap-1">
          <span class="opacity-60">Gateway:</span>
          <span class="font-mono text-xs">{{ data.config.gateway }}</span>
        </div>
      </div>
    </div>

    <Handle type="target" :position="Position.Left" class="!bg-lime-500 !border-lime-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-lime-500 !border-lime-700 !border-2" />
  </div>
</template>
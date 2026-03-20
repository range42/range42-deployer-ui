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
      'bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-950/40 dark:to-cyan-950/40': true,
      'border-teal-400 shadow-lg shadow-teal-200/50 dark:shadow-teal-900/30': selected,
      'border-teal-200 dark:border-teal-800 hover:border-teal-300 dark:hover:border-teal-700': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon name="router-node" class="w-6 h-6" />
      </div>
      <div class="text-xs bg-teal-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        Router
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-semibold text-sm text-teal-900 dark:text-teal-100">
        {{ data.config?.name || 'Network Router' }}
      </div>
      <div class="text-xs text-teal-700/80 dark:text-teal-300/70 space-y-1">
        <div v-if="data.config?.routingProtocol" class="flex items-center gap-1">
          <span class="opacity-60">Protocol:</span>
          <span class="font-semibold">{{ data.config.routingProtocol }}</span>
        </div>
        <div v-if="data.config?.interfaces?.length" class="flex items-center gap-1">
          <span class="opacity-60">Interfaces:</span>
          <span class="font-medium">{{ data.config.interfaces.length }}</span>
        </div>
        <div v-if="data.config?.routerId" class="flex items-center gap-1">
          <span class="opacity-60">ID:</span>
          <span class="font-mono text-xs">{{ data.config.routerId }}</span>
        </div>
      </div>
    </div>

    <!-- Connection Handles - Teal themed -->
    <Handle type="target" :position="Position.Top" class="!bg-teal-500 !border-teal-700 !border-2" />
    <Handle type="source" :position="Position.Bottom" class="!bg-teal-500 !border-teal-700 !border-2" />
    <Handle type="source" :position="Position.Left" class="!bg-cyan-500 !border-cyan-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-cyan-500 !border-cyan-700 !border-2" />
  </div>
</template>
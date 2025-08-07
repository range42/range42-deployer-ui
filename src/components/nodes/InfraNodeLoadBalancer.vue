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
    class="rounded-lg shadow-md p-4 min-w-[200px] border bg-base-100 text-base-content transition-all duration-200"
    :class="{
      'border-2 border-primary shadow-lg': selected,
      'border-base-300 hover:border-base-400': !selected,
    }"
  >
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor}`"></div>
        <span class="text-xl">⚖️</span>
      </div>
      <div class="text-xs opacity-70 uppercase tracking-wide">Load Balancer</div>
    </div>

    <div class="space-y-2">
      <div class="font-medium text-sm">
        {{ data.config?.name || 'Load Balancer' }}
      </div>
      <div class="text-xs opacity-80 space-y-1">
        <div v-if="data.config?.algorithm">
          Algorithm: {{ data.config.algorithm }}
        </div>
        <div v-if="data.config?.servers?.length">
          Servers: {{ data.config.servers.length }}
        </div>
      </div>
    </div>

    <Handle type="target" :position="Position.Left" class="!bg-yellow-500 !border-yellow-600" />
    <Handle type="source" :position="Position.Right" class="!bg-yellow-500 !border-yellow-600" />
  </div>
</template>
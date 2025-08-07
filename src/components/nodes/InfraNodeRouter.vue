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
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor}`"></div>
        <span class="text-xl">🔄</span>
      </div>
      <div class="text-xs opacity-70 uppercase tracking-wide">Router</div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-medium text-sm">
        {{ data.config?.name || 'Network Router' }}
      </div>
      <div class="text-xs opacity-80 space-y-1">
        <div v-if="data.config?.routingProtocol">
          Protocol: {{ data.config.routingProtocol }}
        </div>
        <div v-if="data.config?.interfaces?.length">
          Interfaces: {{ data.config.interfaces.length }}
        </div>
        <div v-if="data.config?.routerId">
          ID: {{ data.config.routerId }}
        </div>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Top" class="!bg-blue-500 !border-blue-600" />
    <Handle type="source" :position="Position.Bottom" class="!bg-blue-500 !border-blue-600" />
    <Handle type="source" :position="Position.Left" class="!bg-green-500 !border-green-600" />
    <Handle type="source" :position="Position.Right" class="!bg-green-500 !border-green-600" />
  </div>
</template>
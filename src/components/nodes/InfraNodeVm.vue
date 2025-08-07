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
    class="rounded-lg shadow-md p-3 min-w-[160px] border bg-base-100 text-base-content transition-all duration-200"
    :class="{
      'border-2 border-primary shadow-lg': selected,
      'border-base-300 hover:border-base-400': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor}`"></div>
        <span class="text-lg">🖥️</span>
      </div>
      <div class="text-xs opacity-70 uppercase tracking-wide">VM</div>
    </div>

    <!-- Node Content -->
    <div class="space-y-1">
      <div class="font-medium text-sm">
        {{ data.config?.name || 'Virtual Machine' }}
      </div>
      <div class="text-xs opacity-80 space-y-1">
        <div v-if="data.config?.cpu">CPU: {{ data.config.cpu }} cores</div>
        <div v-if="data.config?.memory">RAM: {{ data.config.memory }}</div>
        <div v-if="data.config?.os">OS: {{ data.config.os }}</div>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Top" class="!bg-blue-500 !border-blue-600" />
    <Handle type="source" :position="Position.Bottom" class="!bg-blue-500 !border-blue-600" />
  </div>
</template>
<!-- src/components/nodes/DockerNode.vue -->
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
    class="rounded-lg shadow-md p-4 min-w-[180px] border"
    :class="{
      'bg-base-200 text-base-content': true,
      'border-2 border-primary': selected,
      'border-base-300': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor}`"></div>
        <span class="text-lg">🐳</span>
      </div>
      <div class="text-xs opacity-70 uppercase tracking-wide">Container</div>
    </div>

    <!-- Node Content -->
    <div class="space-y-1">
      <div class="font-medium text-sm">
        {{ data.config?.name || 'Docker Container' }}
      </div>
      <div class="text-xs opacity-80 space-y-1">
        <div v-if="data.config?.image">Image: {{ data.config.image }}</div>
        <div v-if="data.config?.ports">Ports: {{ data.config.ports }}</div>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Left" class="!bg-blue-400" />
    <Handle type="source" :position="Position.Right" class="!bg-blue-400" />
  </div>
</template>
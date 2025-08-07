<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'

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
    class="network-container relative w-full h-full"
    :class="{
      'ring-2 ring-primary ring-offset-2': selected,
      'shadow-lg': selected,
    }"
  >
    <!-- Node Resizer with constraints -->
    <NodeResizer 
      min-width="250" 
      min-height="200" 
      max-width="800" 
      max-height="600"
      :style="{ 
        background: selected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
        border: selected ? '1px solid rgb(59, 130, 246)' : 'none'
      }"
    />

    <!-- Network Background - This will now scale with the container -->
    <div 
      class="absolute inset-0 rounded-xl transition-all duration-200"
      :class="{
        'bg-blue-50 dark:bg-blue-950/20': true,
        'border-2 border-dashed border-blue-300 dark:border-blue-600': true,
        'hover:bg-blue-100 dark:hover:bg-blue-950/30 hover:border-blue-400 dark:hover:border-blue-500': true,
      }"
    />

    <!-- Network Header -->
    <div class="absolute top-3 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor}`"></div>
        <span class="text-lg">🌐</span>
        <span class="text-sm font-medium text-base-content">
          {{ data.config?.name || 'Network Zone' }}
        </span>
      </div>
      <div class="text-xs opacity-60 uppercase tracking-wide bg-base-100/90 dark:bg-base-300/90 px-2 py-1 rounded backdrop-blur-sm">
        Network
      </div>
    </div>

    <!-- Network Details -->
    <div class="absolute top-11 left-4 text-xs space-y-1 pointer-events-none z-10">
      <div v-if="data.config?.cidr" class="bg-base-100/90 dark:bg-base-300/90 text-base-content px-2 py-1 rounded backdrop-blur-sm inline-block">
        CIDR: {{ data.config.cidr }}
      </div>
      <div v-if="data.config?.gateway" class="bg-base-100/90 dark:bg-base-300/90 text-base-content px-2 py-1 rounded backdrop-blur-sm inline-block ml-2">
        Gateway: {{ data.config.gateway }}
      </div>
    </div>

    <!-- Drop Zone Hint (when empty) - Now properly centered -->
    <div 
      v-if="!data.hasChildren" 
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-5"
    >
      <div class="text-center opacity-40 text-base-content">
        <div class="text-3xl mb-2">📦</div>
        <div class="text-sm font-medium">Drop VMs and containers here</div>
        <div class="text-xs mt-1">Drag components into this network zone</div>
      </div>
    </div>

    <!-- Connection Handles with better positioning -->
    <Handle 
      type="target" 
      :position="Position.Top" 
      class="!bg-blue-500 !border-2 !border-blue-600 !w-4 !h-4 !rounded-full"
      :style="{ top: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Bottom" 
      class="!bg-blue-500 !border-2 !border-blue-600 !w-4 !h-4 !rounded-full"
      :style="{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Left" 
      class="!bg-blue-500 !border-2 !border-blue-600 !w-4 !h-4 !rounded-full"
      :style="{ left: '-8px', top: '50%', transform: 'translateY(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Right" 
      class="!bg-blue-500 !border-2 !border-blue-600 !w-4 !h-4 !rounded-full"
      :style="{ right: '-8px', top: '50%', transform: 'translateY(-50%)' }"
    />
  </div>
</template>

<style scoped>
.network-container {
  /* Ensure the container takes full available space */
  min-width: 250px;
  min-height: 200px;
}

/* Smooth transitions for all interactive states */
.network-container * {
  transition: all 0.2s ease;
}

/* Ensure proper layering of child nodes */
.network-container :deep(.vue-flow__node) {
  z-index: 10;
  position: relative;
}

/* Handle hover effects */
.network-container:hover :deep(.vue-flow__handle) {
  opacity: 1;
  transform: scale(1.1);
}

/* Default handle state */
.network-container :deep(.vue-flow__handle) {
  opacity: 0.7;
  transition: all 0.2s ease;
}

/* Ensure proper backdrop for network info */
.network-container .backdrop-blur-sm {
  backdrop-filter: blur(4px);
}
</style>
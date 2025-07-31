<script setup>
import { computed, onMounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import '@vue-flow/node-resizer/dist/style.css'

const props = defineProps({
  id: String,
  type: String,
  data: Object,
  selected: Boolean
})

const emit = defineEmits(['resize', 'edit'])

// Node configuration based on type
const nodeConfig = computed(() => {
  const configs = {
    network: {
      icon: '🌐',
      title: 'Network',
      bgColor: 'rgba(59, 130, 246, 0.1)',
      borderColor: 'rgba(59, 130, 246, 0.5)',
      iconBg: 'from-blue-500 to-blue-600'
    },
    subnet: {
      icon: '🔗',
      title: 'Subnet',
      bgColor: 'rgba(34, 197, 94, 0.1)',
      borderColor: 'rgba(34, 197, 94, 0.5)',
      iconBg: 'from-green-500 to-green-600'
    }
  }
  return configs[props.type] || configs.network
})

// Status colors
const statusColors = {
  gray: 'bg-gray-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  green: 'bg-green-500'
}

// Handle resize events properly with validation
const handleResize = (event) => {
  console.log('Resize event:', event)
  if (event && event.params) {
    const { width, height } = event.params
    if (typeof width === 'number' && typeof height === 'number' &&
        !isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      emit('resize', props.id, { width, height })
    } else {
      console.warn('Invalid resize dimensions:', { width, height })
    }
  }
}

// Handle edit click
const handleEdit = () => {
  console.log('Edit clicked for node:', props.id)
  emit('edit', props.id, props.data)
}

// Minimum sizes
const minWidth = props.type === 'network' ? 400 : 300
const minHeight = props.type === 'network' ? 300 : 200

// Debug on mount
onMounted(() => {
  console.log('NetworkNode mounted:', { id: props.id, type: props.type, selected: props.selected })
})
</script>

<template>
  <div
    class="network-node"
    :class="{ 'selected': selected }"
    :style="{
      backgroundColor: nodeConfig.bgColor,
      border: `2px dashed ${nodeConfig.borderColor}`,
      borderRadius: '8px',
      width: '100%',
      height: '100%',
      position: 'relative',
      minWidth: `${minWidth}px`,
      minHeight: `${minHeight}px`
    }"
  >
    <!-- Node Resizer with proper configuration -->
    <NodeResizer
      :min-width="minWidth"
      :min-height="minHeight"
      :selected="selected"
      @resize="handleResize"
      color="#3b82f6"
      :handle-style="{
        width: '8px',
        height: '8px',
        borderRadius: '4px'
      }"
    />

    <!-- Handles for connections with proper positioning -->
    <Handle
      type="source"
      :position="Position.Right"
      :style="{
        background: '#3b82f6',
        width: '12px',
        height: '12px',
        border: '2px solid white',
        zIndex: 10
      }"
    />
    <Handle
      type="target"
      :position="Position.Left"
      :style="{
        background: '#3b82f6',
        width: '12px',
        height: '12px',
        border: '2px solid white',
        zIndex: 10
      }"
    />

    <!-- Header -->
    <div class="absolute top-0 left-0 right-0 p-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <!-- Icon -->
        <div
          :class="`w-10 h-10 rounded-lg bg-gradient-to-br ${nodeConfig.iconBg} flex items-center justify-center shadow-md`"
        >
          <span class="text-xl text-white">{{ nodeConfig.icon }}</span>
        </div>

        <!-- Title and Info -->
        <div>
          <h3 class="font-semibold text-base-content">
            {{ data.config?.name || data.label }}
          </h3>
          <p class="text-xs text-base-content/60">
            {{ data.config?.cidr || 'No CIDR configured' }}
          </p>
        </div>
      </div>

      <!-- Status and Edit -->
      <div class="flex items-center gap-2">
        <div
          :class="`w-3 h-3 rounded-full ${statusColors[data.status || 'gray']} shadow-sm`"
          :title="`Status: ${data.status || 'gray'}`"
        ></div>

        <!-- Edit Button -->
        <button
          @click="handleEdit"
          class="btn btn-ghost btn-xs p-1 hover:bg-base-200 rounded"
          title="Edit configuration"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
          </svg>
        </button>
      </div>
    </div>

    <!-- Drop Zone Indicator -->
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div class="text-center opacity-20">
        <p class="text-sm font-medium">Drop nodes here</p>
        <p class="text-xs opacity-75">to add to {{ nodeConfig.title.toLowerCase() }}</p>
      </div>
    </div>

    <!-- Configuration Summary -->
    <div class="absolute bottom-0 left-0 right-0 p-4">
      <div class="text-xs text-base-content/50 space-y-1">
        <div class="flex justify-between">
          <span>Gateway:</span>
          <span class="font-mono">{{ data.config?.gateway || 'Not set' }}</span>
        </div>
        <div class="flex justify-between" v-if="data.config?.dns">
          <span>DNS:</span>
          <span class="font-mono">{{ data.config.dns.join(', ') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.network-node {
  transition: all 0.2s ease-in-out;
  cursor: move;
}

.network-node:hover {
  border-style: solid !important;
  transform: scale(1.02);
}

/* Highlight drop zone on drag over */
.network-node.drag-over {
  background-color: rgba(59, 130, 246, 0.2) !important;
  border-color: rgba(59, 130, 246, 0.8) !important;
  transform: scale(1.05);
}

/* Vue Flow specific styles */
:deep(.vue-flow__resize-control) {
  opacity: 0;
  transition: opacity 0.2s;
}

.network-node:hover :deep(.vue-flow__resize-control) {
  opacity: 1;
}

.selected :deep(.vue-flow__resize-control) {
  opacity: 1;
}

/* Ensure proper handle positioning */
:deep(.vue-flow__handle) {
  position: absolute;
  pointer-events: all;
}

/* Ensure the node is draggable */
:deep(.vue-flow__node) {
  cursor: move;
}

/* Style the edit button */
.btn-ghost:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

/* Fix for Vue Flow node positioning */
:deep(.vue-flow__node-custom) {
  cursor: move;
}
</style>

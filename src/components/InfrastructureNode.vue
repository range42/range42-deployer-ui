<script setup>
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  id: String,
  type: String,
  data: Object,
  selected: Boolean
})

const emit = defineEmits(['update', 'delete'])

// Node type configurations
const nodeConfigs = {
  // VMs
  'vm-windows': {
    icon: '🪟',
    color: 'from-blue-500 to-cyan-600',
    canConnect: true
  },
  'vm-linux': {
    icon: '🐧',
    color: 'from-orange-500 to-red-600',
    canConnect: true
  },
  'vm-freebsd': {
    icon: '👹',
    color: 'from-red-600 to-pink-600',
    canConnect: true
  },
  'vm-macos': {
    icon: '🍎',
    color: 'from-gray-700 to-gray-900',
    canConnect: true
  },

  // Network Infrastructure
  'router': {
    icon: '🛣️',
    color: 'from-indigo-500 to-purple-600',
    canConnect: true
  },
  'firewall': {
    icon: '🔥',
    color: 'from-red-500 to-orange-600',
    canConnect: true
  },
  'load-balancer': {
    icon: '⚖️',
    color: 'from-teal-500 to-cyan-600',
    canConnect: true
  },

  // Applications
  'docker': {
    icon: '🐳',
    color: 'from-blue-400 to-blue-600',
    canConnect: true,
    sourceOnly: true
  },
  'nginx': {
    icon: '🌐',
    color: 'from-green-500 to-emerald-600',
    canConnect: true,
    sourceOnly: true
  },
  'apache': {
    icon: '🦅',
    color: 'from-red-600 to-orange-700',
    canConnect: true,
    sourceOnly: true
  },
  'ftp': {
    icon: '📁',
    color: 'from-yellow-500 to-amber-600',
    canConnect: true,
    sourceOnly: true
  },
  'database': {
    icon: '🗄️',
    color: 'from-purple-500 to-indigo-600',
    canConnect: true,
    sourceOnly: true
  },
  'mail': {
    icon: '📧',
    color: 'from-blue-500 to-indigo-600',
    canConnect: true,
    sourceOnly: true
  },
  'dns': {
    icon: '🔍',
    color: 'from-green-600 to-teal-700',
    canConnect: true,
    sourceOnly: true
  },
  'vpn': {
    icon: '🔒',
    color: 'from-purple-600 to-pink-700',
    canConnect: true,
    sourceOnly: true
  }
}

const nodeConfig = computed(() => nodeConfigs[props.type] || { icon: '❓', color: 'from-gray-500 to-gray-600' })

const showConfig = ref(false)

const statusColors = {
  gray: 'bg-gray-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  green: 'bg-green-500'
}

const updateConfig = (key, value) => {
  emit('update', props.id, {
    ...props.data,
    config: {
      ...props.data.config,
      [key]: value
    }
  })
}

const handleDelete = () => {
  if (confirm('Are you sure you want to delete this node?')) {
    emit('delete', props.id)
  }
}

// Determine if node should show handles
const showSourceHandle = computed(() => nodeConfig.value.canConnect)
const showTargetHandle = computed(() => nodeConfig.value.canConnect && !nodeConfig.value.sourceOnly)
</script>

<template>
  <div class="node-wrapper">
    <!-- Connection Handles -->
    <Handle
      v-if="showSourceHandle"
      type="source"
      :position="Position.Right"
      :style="{
        background: '#3b82f6',
        width: '10px',
        height: '10px',
        border: '2px solid white',
        borderRadius: '50%'
      }"
    />
    <Handle
      v-if="showTargetHandle"
      type="target"
      :position="Position.Left"
      :style="{
        background: '#3b82f6',
        width: '10px',
        height: '10px',
        border: '2px solid white',
        borderRadius: '50%'
      }"
    />

    <div
      class="infrastructure-node"
      :class="{ 'selected': selected }"
    >
      <!-- Header -->
      <div class="node-header">
        <div class="flex items-center gap-2">
          <div :class="`node-icon bg-gradient-to-br ${nodeConfig.color}`">
            <span class="text-xl">{{ nodeConfig.icon }}</span>
          </div>
          <div class="flex-1">
            <h3 class="font-semibold text-sm">{{ data.label }}</h3>
            <p class="text-xs opacity-60">{{ data.config?.name || 'Unnamed' }}</p>
          </div>
          <div
            :class="`status-indicator ${statusColors[data.status || 'gray']}`"
            :title="`Status: ${data.status || 'gray'}`"
          ></div>
        </div>
      </div>

      <!-- Quick Info -->
      <div class="node-info">
        <div class="info-grid">
          <template v-if="type.startsWith('vm-')">
            <div class="info-item">
              <span class="label">CPU:</span>
              <span class="value">{{ data.config?.cpu || 0 }}</span>
            </div>
            <div class="info-item">
              <span class="label">Memory:</span>
              <span class="value">{{ data.config?.memory || '0GB' }}</span>
            </div>
          </template>

          <template v-else-if="type === 'docker'">
            <div class="info-item col-span-2">
              <span class="label">Image:</span>
              <span class="value text-xs">{{ data.config?.image || 'none' }}</span>
            </div>
          </template>

          <template v-else-if="type === 'database'">
            <div class="info-item">
              <span class="label">Type:</span>
              <span class="value">{{ data.config?.type || 'none' }}</span>
            </div>
            <div class="info-item">
              <span class="label">Port:</span>
              <span class="value">{{ data.config?.port || '0' }}</span>
            </div>
          </template>

          <template v-else>
            <div class="info-item col-span-2">
              <span class="label">Type:</span>
              <span class="value">{{ type }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- Actions -->
      <div class="node-actions">
        <button
          @click="showConfig = !showConfig"
          class="btn btn-xs btn-ghost"
          :class="{ 'btn-active': showConfig }"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
        </button>
        <button
          @click="handleDelete"
          class="btn btn-xs btn-ghost text-error"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
          </svg>
        </button>
      </div>

      <!-- Configuration Panel -->
      <transition name="config-panel">
        <div v-if="showConfig" class="config-panel">
          <div class="space-y-2">
            <div class="form-control">
              <label class="label">
                <span class="label-text text-xs">Name</span>
              </label>
              <input
                type="text"
                :value="data.config?.name"
                @input="e => updateConfig('name', e.target.value)"
                class="input input-bordered input-xs"
                placeholder="Enter name"
              />
            </div>

            <!-- Type-specific configurations -->
            <template v-if="type.startsWith('vm-')">
              <div class="grid grid-cols-2 gap-2">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text text-xs">CPU Cores</span>
                  </label>
                  <input
                    type="number"
                    :value="data.config?.cpu"
                    @input="e => updateConfig('cpu', parseInt(e.target.value))"
                    class="input input-bordered input-xs"
                    min="1"
                    max="32"
                  />
                </div>
                <div class="form-control">
                  <label class="label">
                    <span class="label-text text-xs">Memory</span>
                  </label>
                  <select
                    :value="data.config?.memory"
                    @change="e => updateConfig('memory', e.target.value)"
                    class="select select-bordered select-xs"
                  >
                    <option>2GB</option>
                    <option>4GB</option>
                    <option>8GB</option>
                    <option>16GB</option>
                    <option>32GB</option>
                  </select>
                </div>
              </div>
            </template>

            <template v-else-if="type === 'docker'">
              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs">Docker Image</span>
                </label>
                <input
                  type="text"
                  :value="data.config?.image"
                  @input="e => updateConfig('image', e.target.value)"
                  class="input input-bordered input-xs"
                  placeholder="e.g., nginx:latest"
                />
              </div>
            </template>

            <template v-else-if="type === 'database'">
              <div class="grid grid-cols-2 gap-2">
                <div class="form-control">
                  <label class="label">
                    <span class="label-text text-xs">DB Type</span>
                  </label>
                  <select
                    :value="data.config?.type"
                    @change="e => updateConfig('type', e.target.value)"
                    class="select select-bordered select-xs"
                  >
                    <option>PostgreSQL</option>
                    <option>MySQL</option>
                    <option>MongoDB</option>
                    <option>Redis</option>
                  </select>
                </div>
                <div class="form-control">
                  <label class="label">
                    <span class="label-text text-xs">Port</span>
                  </label>
                  <input
                    type="number"
                    :value="data.config?.port"
                    @input="e => updateConfig('port', parseInt(e.target.value))"
                    class="input input-bordered input-xs"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.node-wrapper {
  position: relative;
}

.infrastructure-node {
  background: white;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  min-width: 250px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
}

.infrastructure-node:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.infrastructure-node.selected {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.node-header {
  padding: 12px;
  border-bottom: 1px solid #f3f4f6;
}

.node-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.node-info {
  padding: 8px 12px;
  background: #f9fafb;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.info-item .label {
  color: #6b7280;
}

.info-item .value {
  font-weight: 500;
  color: #374151;
}

.col-span-2 {
  grid-column: span 2;
}

.node-actions {
  padding: 8px;
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  border-top: 1px solid #f3f4f6;
}

.config-panel {
  padding: 12px;
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
}

.config-panel-enter-active,
.config-panel-leave-active {
  transition: all 0.2s ease;
}

.config-panel-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.config-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Handle hover effects */
:deep(.vue-flow__handle) {
  transition: all 0.2s ease;
}

:deep(.vue-flow__handle:hover) {
  transform: scale(1.2);
}
</style>

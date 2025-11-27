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

const serviceTypes = {
  'git': { icon: '📚', label: 'Git', color: 'orange' },
  'gitea': { icon: '🍵', label: 'Gitea', color: 'green' },
  'gitlab': { icon: '🦊', label: 'GitLab', color: 'orange' },
  'chat': { icon: '💬', label: 'Chat', color: 'blue' },
  'mattermost': { icon: '💬', label: 'Mattermost', color: 'blue' },
  'wiki': { icon: '📖', label: 'Wiki', color: 'teal' },
  'bookstack': { icon: '📖', label: 'BookStack', color: 'blue' },
  'auth': { icon: '🔐', label: 'Auth', color: 'red' },
  'keycloak': { icon: '🔑', label: 'Keycloak', color: 'gray' },
  'registry': { icon: '📦', label: 'Registry', color: 'cyan' },
  'harbor': { icon: '⚓', label: 'Harbor', color: 'teal' },
  'monitoring': { icon: '📊', label: 'Monitoring', color: 'yellow' },
  'grafana': { icon: '📈', label: 'Grafana', color: 'orange' },
  'default': { icon: '🔧', label: 'Service', color: 'amber' }
}

const serviceInfo = computed(() => {
  const type = props.data.config?.serviceType?.toLowerCase() || 'default'
  return serviceTypes[type] || serviceTypes.default
})
</script>

<template>
  <div
    class="rounded-lg shadow-md p-4 min-w-[190px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-yellow-950/30': true,
      'border-amber-400 shadow-lg shadow-amber-200/50 dark:shadow-amber-900/30': selected,
      'border-amber-200 dark:border-amber-900 hover:border-amber-300 dark:hover:border-amber-800': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-xl">{{ serviceInfo.icon }}</span>
      </div>
      <div class="text-xs bg-amber-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        Service
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-semibold text-sm text-amber-900 dark:text-amber-100">
        {{ data.config?.name || 'Shared Service' }}
      </div>
      
      <div class="text-xs text-amber-700/80 dark:text-amber-300/70 space-y-1">
        <div v-if="data.config?.serviceType" class="flex items-center gap-1">
          <span class="opacity-60">Type:</span>
          <span class="font-semibold">{{ serviceInfo.label }}</span>
        </div>
        <div v-if="data.config?.version" class="flex items-center gap-1">
          <span class="opacity-60">Version:</span>
          <span class="font-medium">{{ data.config.version }}</span>
        </div>
        <div v-if="data.config?.port" class="flex items-center gap-1">
          <span class="opacity-60">Port:</span>
          <span class="font-mono">{{ data.config.port }}</span>
        </div>
        <div v-if="data.config?.url" class="flex items-center gap-1">
          <span class="opacity-60">URL:</span>
          <span class="font-mono text-xs truncate max-w-[120px]">{{ data.config.url }}</span>
        </div>
      </div>
    </div>

    <!-- Access Level Badge -->
    <div v-if="data.config?.accessLevel" class="mt-2">
      <span :class="[
        'text-xs px-2 py-0.5 rounded-full font-medium',
        data.config.accessLevel === 'public' 
          ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
          : data.config.accessLevel === 'internal'
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
            : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
      ]">
        {{ data.config.accessLevel }}
      </span>
    </div>

    <!-- High Availability Badge -->
    <div v-if="data.config?.highAvailability" class="mt-2">
      <span class="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-medium">
        HA Enabled
      </span>
    </div>

    <!-- Connection Handles - Amber themed -->
    <Handle type="target" :position="Position.Left" class="!bg-amber-500 !border-amber-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-amber-500 !border-amber-700 !border-2" />
  </div>
</template>

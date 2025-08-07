<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'

const props = defineProps(['data', 'selected'])

const segmentTypes = {
  'management': { color: 'bg-blue-500', icon: '🛠️', label: 'Management' },
  'production': { color: 'bg-green-500', icon: '🏭', label: 'Production' },
  'dmz': { color: 'bg-orange-500', icon: '🔶', label: 'DMZ' },
  'guest': { color: 'bg-purple-500', icon: '👥', label: 'Guest' },
  'iot': { color: 'bg-cyan-500', icon: '📱', label: 'IoT/OT' },
  'security': { color: 'bg-red-500', icon: '🔒', label: 'Security' }
}

const segmentInfo = computed(() => {
  return segmentTypes[props.data.config?.segmentType] || segmentTypes.production
})

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
    class="network-segment-container relative w-full h-full"
    :class="{
      'ring-2 ring-primary ring-offset-2': selected,
      'shadow-lg': selected,
    }"
  >
    <NodeResizer 
      min-width="300" 
      min-height="250" 
      max-width="1000" 
      max-height="800"
    />

    <!-- Enhanced Network Background with segment type styling -->
    <div 
      class="absolute inset-0 rounded-xl transition-all duration-200 border-2 border-dashed"
      :class="[
        segmentInfo.color.replace('bg-', 'bg-') + '/20',
        segmentInfo.color.replace('bg-', 'border-') + '/40',
        'hover:' + segmentInfo.color.replace('bg-', 'bg-') + '/30'
      ]"
    />

    <!-- Enhanced Network Header -->
    <div class="absolute top-3 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
      <div class="flex items-center space-x-3">
        <div :class="`w-4 h-4 rounded-full ${statusColor}`"></div>
        <span class="text-xl">{{ segmentInfo.icon }}</span>
        <div>
          <div class="text-sm font-medium text-base-content">
            {{ data.config?.name || segmentInfo.label + ' Segment' }}
          </div>
          <div class="text-xs opacity-70">
            {{ data.config?.vlan ? `VLAN ${data.config.vlan}` : '' }}
            {{ data.config?.subnet || data.config?.cidr || '' }}
          </div>
        </div>
      </div>
      <div class="text-xs opacity-60 uppercase tracking-wide bg-base-100/90 px-2 py-1 rounded backdrop-blur-sm">
        {{ segmentInfo.label }}
      </div>
    </div>

    <!-- Network Security Level Indicator -->
    <div v-if="data.config?.securityLevel" class="absolute top-3 right-4 z-10">
      <div class="badge badge-sm" :class="{
        'badge-error': data.config.securityLevel === 'high',
        'badge-warning': data.config.securityLevel === 'medium',
        'badge-success': data.config.securityLevel === 'low'
      }">
        {{ data.config.securityLevel.toUpperCase() }} SEC
      </div>
    </div>

    <!-- Network Details Panel -->
    <div class="absolute top-16 left-4 space-y-1 pointer-events-none z-10">
      <div v-if="data.config?.gateway" class="text-xs bg-base-100/90 text-base-content px-2 py-1 rounded backdrop-blur-sm inline-block">
        GW: {{ data.config.gateway }}
      </div>
      <div v-if="data.config?.dns" class="text-xs bg-base-100/90 text-base-content px-2 py-1 rounded backdrop-blur-sm inline-block ml-2">
        DNS: {{ data.config.dns }}
      </div>
      <div v-if="data.config?.dhcp" class="text-xs bg-base-100/90 text-base-content px-2 py-1 rounded backdrop-blur-sm inline-block">
        DHCP: {{ data.config.dhcp ? 'Enabled' : 'Disabled' }}
      </div>
    </div>

    <!-- Connection Handles with role-based colors -->
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
      class="!bg-green-500 !border-2 !border-green-600 !w-4 !h-4 !rounded-full"
      :style="{ left: '-8px', top: '30%', transform: 'translateY(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Right" 
      class="!bg-red-500 !border-2 !border-red-600 !w-4 !h-4 !rounded-full"
      :style="{ right: '-8px', top: '30%', transform: 'translateY(-50%)' }"
    />
  </div>
</template>
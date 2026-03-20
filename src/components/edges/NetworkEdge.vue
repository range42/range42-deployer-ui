<script setup>
/**
 * Custom Network Edge Component
 * 
 * Displays IP address and interface name on the connection line.
 * Best practice for network diagrams - shows addressing at a glance.
 */
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  id: String,
  source: String,
  target: String,
  sourceX: Number,
  sourceY: Number,
  targetX: Number,
  targetY: Number,
  sourcePosition: String,
  targetPosition: String,
  data: Object,
  markerEnd: String,
  style: Object,
  selected: Boolean,
})

// Compute the bezier path for the edge
const path = computed(() => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  return { edgePath, labelX, labelY }
})

// Extract connection info from edge data
const connectionInfo = computed(() => {
  const conn = props.data?.connection || props.data || {}
  return {
    interfaceName: conn.interfaceName || '',
    ipAddress: conn.ipAddress || '',
    firewall: conn.firewall ?? true,
    vlanTag: conn.vlanTag,
  }
})

// Format IP for display (remove CIDR if too long)
const displayIp = computed(() => {
  const ip = connectionInfo.value.ipAddress
  if (!ip) return 'DHCP'
  // Show full CIDR for short addresses, truncate for long ones
  if (ip.length > 18) {
    return ip.split('/')[0]
  }
  return ip
})

// Determine label background color based on connection type
const labelClass = computed(() => {
  const conn = connectionInfo.value
  if (conn.vlanTag) return 'bg-amber-100 dark:bg-amber-900/60 border-amber-300 dark:border-amber-700'
  if (!conn.ipAddress) return 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600'
  return 'bg-sky-100 dark:bg-sky-900/60 border-sky-300 dark:border-sky-700'
})
</script>

<template>
  <BaseEdge 
    :id="id" 
    :path="path.edgePath" 
    :marker-end="markerEnd"
    :style="{
      ...style,
      strokeWidth: selected ? 3 : 2,
      stroke: selected ? '#3b82f6' : '#64748b',
    }"
  />
  
  <!-- Edge Label showing IP/Interface info -->
  <EdgeLabelRenderer>
    <div
      :style="{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${path.labelX}px, ${path.labelY}px)`,
        pointerEvents: 'all',
      }"
      class="edge-label-container nodrag nopan"
    >
      <div 
        :class="[
          'edge-label rounded-md border px-2 py-1 shadow-sm transition-all',
          labelClass,
          { 'ring-2 ring-primary ring-offset-1': selected }
        ]"
      >
        <!-- Interface Name -->
        <div v-if="connectionInfo.interfaceName" class="text-[10px] font-semibold text-slate-600 dark:text-slate-300 leading-tight">
          {{ connectionInfo.interfaceName }}
        </div>
        
        <!-- IP Address -->
        <div class="font-mono text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight">
          {{ displayIp }}
        </div>
        
        <!-- Indicators -->
        <div class="flex items-center gap-1 mt-0.5">
          <!-- VLAN indicator -->
          <span v-if="connectionInfo.vlanTag" class="text-[9px] bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-1 rounded font-medium">
            VLAN {{ connectionInfo.vlanTag }}
          </span>
          <!-- Firewall indicator -->
          <AppIcon v-if="connectionInfo.firewall" name="shield" class="w-2.5 h-2.5" title="Firewall enabled" />
        </div>
      </div>
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.edge-label-container {
  z-index: 1000;
}

.edge-label {
  min-width: 60px;
  text-align: center;
  backdrop-filter: blur(4px);
}

/* Hover effect */
.edge-label:hover {
  transform: scale(1.05);
}
</style>

<script setup>
/**
 * Custom Network Edge Component
 * 
 * Displays IP address and interface name on the connection line.
 * Best practice for network diagrams - shows addressing at a glance.
 */
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useVueFlow } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'
import { getNetworkColor } from '@/constants/networkColors'

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

const { findNode, getNodes } = useVueFlow()

// Resolve the network segment color from the connected network node
const networkColor = computed(() => {
  const sourceNode = findNode(props.source)
  const targetNode = findNode(props.target)
  const networkNode = sourceNode?.type === 'network-segment' ? sourceNode
    : targetNode?.type === 'network-segment' ? targetNode
    : null
  if (!networkNode) return getNetworkColor('custom')
  const segmentType = networkNode.data?.config?.segmentType || 'custom'
  return getNetworkColor(segmentType)
})

// Replication intent: read from edge.data.replication_intent; badge only renders
// for fan_out | mesh. For fan_out we show the N from the nearest team_scope group.
const replicationIntent = computed(() => props.data?.replication_intent || null)

const replicationCount = computed(() => {
  if (!replicationIntent.value || replicationIntent.value === 'pair_scoped') return 0
  const allNodes = getNodes?.value || []
  // Walk parent chain to find nearest team_scope group for either endpoint
  const findScope = (nodeId) => {
    const byId = new Map(allNodes.map((n) => [n.id, n]))
    let curId = byId.get(nodeId)?.parentNode || byId.get(nodeId)?.parent || null
    const seen = new Set()
    while (curId && !seen.has(curId)) {
      seen.add(curId)
      const p = byId.get(curId)
      if (!p) return null
      if (p.type === 'group' && p.data?.kind === 'team_scope') return p
      curId = p.parentNode || p.parent || null
    }
    return null
  }
  const srcScope = findScope(props.source)
  const tgtScope = findScope(props.target)
  const scope = srcScope || tgtScope
  if (!scope) return 0
  const n = Number(scope.data?.team_count ?? scope.data?.defaults?.team_count ?? 1)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
})

const replicationBadge = computed(() => {
  if (!replicationIntent.value) return null
  if (replicationIntent.value === 'pair_scoped') return null
  return {
    intent: replicationIntent.value,
    count: replicationCount.value,
    label: `×${replicationCount.value || 'N'}`,
    title: replicationIntent.value === 'fan_out'
      ? `Fan-out: replicated ×${replicationCount.value || 'N'} per team`
      : `Mesh: both endpoints live in the same team_scope (×${replicationCount.value || 'N'})`,
  }
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

// Determine label style dynamically from the network segment color
const labelStyle = computed(() => {
  const color = networkColor.value
  return {
    backgroundColor: color.bg,
    borderColor: color.border,
    color: color.label,
  }
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
      stroke: networkColor.stroke,
      opacity: selected ? 1 : 0.85,
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
          { 'ring-2 ring-primary ring-offset-1': selected }
        ]"
        :style="labelStyle"
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

      <!-- Replication intent badge — rendered near midpoint for fan_out / mesh -->
      <div
        v-if="replicationBadge"
        class="replication-badge mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold shadow"
        :class="{
          'bg-indigo-600 text-white': replicationBadge.intent === 'fan_out',
          'bg-violet-600 text-white': replicationBadge.intent === 'mesh',
        }"
        :data-testid="`replication-badge-${id}`"
        :data-intent="replicationBadge.intent"
        :title="replicationBadge.title"
      >
        <span>{{ replicationBadge.intent === 'fan_out' ? 'fan-out' : 'mesh' }}</span>
        <span class="font-mono">{{ replicationBadge.label }}</span>
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

<script setup>
/**
 * Docker Tether Edge
 *
 * A VueFlow custom edge that renders a dashed gray line with no arrow,
 * connecting a Docker node to its VM/LXC host. The edge is purely visual
 * (containment, not traffic) — computed from `docker.data.host_ref`.
 */
import { computed } from 'vue'
import { BaseEdge, getBezierPath } from '@vue-flow/core'

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
  style: Object,
  selected: Boolean,
})

const path = computed(() => {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  return edgePath
})

const edgeStyle = computed(() => ({
  ...(props.style || {}),
  strokeDasharray: '6 4',
  stroke: props.selected ? '#475569' /* slate-600 */ : '#94a3b8' /* slate-400 */,
  strokeWidth: props.selected ? 2 : 1.5,
  fill: 'none',
  opacity: 0.9,
}))
</script>

<template>
  <!-- marker-end intentionally omitted — this is a containment tether, not a directional link -->
  <BaseEdge
    :id="id"
    :path="path"
    :style="edgeStyle"
    :data-testid="`docker-tether-${id}`"
  />
</template>

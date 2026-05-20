<script setup>
import { useVueFlow } from '@vue-flow/core'

defineProps({
  zones: { type: Array, default: () => [] }
})

const { viewport } = useVueFlow()
</script>

<template>
  <!--
    `vue-flow__container` matches the Background convention (absolute, full-size).
    z-index: 3 sits explicitly ABOVE the background grid (default stacking within
    .vue-flow, z-index 0) and BELOW the node/edge viewport (.vue-flow__viewport,
    z-index 4) — so zones always paint behind nodes and in front of the grid.
  -->
  <svg
    class="vue-flow__container vue-flow__zone-overlay"
    style="z-index: 3; pointer-events: none; overflow: visible;"
  >
    <g :transform="`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`">
      <g v-for="zone in zones" :key="zone.id">
        <rect
          :x="zone.x"
          :y="zone.y"
          :width="zone.width"
          :height="zone.height"
          :fill="zone.color.bg"
          :stroke="zone.color.border"
          stroke-width="1"
          stroke-dasharray="6 3"
          rx="12"
          ry="12"
        />
        <text
          :x="zone.x + 10"
          :y="zone.y + 16"
          :fill="zone.color.border"
          font-size="10"
          font-weight="700"
          letter-spacing="1"
        >{{ zone.label }}</text>
      </g>
    </g>
  </svg>
</template>

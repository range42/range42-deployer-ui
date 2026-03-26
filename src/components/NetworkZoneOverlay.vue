<script setup>
import { useVueFlow } from '@vue-flow/core'

defineProps({
  zones: { type: Array, default: () => [] }
})

const { viewport } = useVueFlow()
</script>

<template>
  <svg
    class="vue-flow__zone-overlay"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;"
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

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
    aria-hidden="true"
  >
    <g :transform="`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`">
      <g v-for="zone in zones" :key="zone.id" :data-background-id="zone.id" :data-background-kind="zone.kind">
        <rect
          :x="zone.x"
          :y="zone.y"
          :width="zone.width"
          :height="zone.height"
          :fill="zone.color.bg"
          :stroke="zone.color.border"
          :stroke-width="zone.kind === 'group' ? 1 : 1.5"
          :stroke-dasharray="zone.kind === 'group' ? '8 6' : '5 4'"
          rx="16"
          ry="16"
        />
        <foreignObject
          v-if="zone.label"
          :x="zone.x + 12"
          :y="zone.y + 8"
          :width="Math.max(0, zone.width - 24)"
          height="26"
        >
          <div xmlns="http://www.w3.org/1999/xhtml" class="zone-label" :style="{ color: zone.color.label }">{{ zone.label }}</div>
        </foreignObject>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.zone-label { display: inline-block; max-width: 100%; padding: 3px 7px; border-radius: 5px; background: var(--color-base-100); font-size: 12px; line-height: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

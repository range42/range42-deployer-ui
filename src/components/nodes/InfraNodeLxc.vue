<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'
import { getTagColor } from '@/constants/tags'

const props = defineProps(['data', 'selected'])

const statusClass = computed(() => {
  const status = props.data?.status || 'gray'
  return `status-${status}`
})
const displayTags = computed(() => (props.data?.tags || []).slice(0, 3))
const overflowCount = computed(() => Math.max(0, (props.data?.tags || []).length - 3))

const metrics = computed(() => props.data?.liveMetrics)

function barColor(percent) {
  if (percent > 80) return '#ef4444'  // red
  if (percent > 50) return '#f59e0b'  // amber
  return '#22c55e'                     // green
}
</script>

<template>
  <div
    class="infra-node"
    :class="[statusClass, { 'ring-2 ring-primary ring-offset-2': selected }]"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-2.5">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
          <AppIcon name="cube" class="w-5 h-5" />
        </div>
        <div>
          <div class="font-semibold text-sm">
            {{ data.config?.name || 'Container' }}
          </div>
          <div class="text-[10px] text-base-content/50 uppercase tracking-wide">LXC</div>
        </div>
      </div>
      <div :class="`status-dot ${data?.status || 'gray'}`"></div>
    </div>

    <!-- Tags -->
    <div v-if="displayTags.length" class="flex gap-1 flex-wrap mb-1.5">
      <span
        v-for="tag in displayTags"
        :key="tag"
        class="px-1.5 py-0 rounded-full text-[9px] font-semibold text-white leading-relaxed"
        :style="{ backgroundColor: getTagColor(tag).hex }"
      >{{ tag }}</span>
      <span v-if="overflowCount > 0" class="text-[9px] text-base-content/40">+{{ overflowCount }}</span>
    </div>

    <!-- Live metrics (running) or static specs (stopped) -->
    <div v-if="metrics" class="grid grid-cols-2 gap-1.5 text-xs">
      <div class="flex items-center gap-1 px-2 py-1">
        <span class="text-base-content/40 text-[10px]">CPU</span>
        <div class="flex-1 h-1 bg-base-content/10 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500" :style="{ width: metrics.cpu + '%', backgroundColor: barColor(metrics.cpu) }"></div>
        </div>
        <span class="text-[9px] font-medium min-w-[28px] text-right">{{ Math.round(metrics.cpu) }}%</span>
      </div>
      <div class="flex items-center gap-1 px-2 py-1">
        <span class="text-base-content/40 text-[10px]">RAM</span>
        <div class="flex-1 h-1 bg-base-content/10 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500" :style="{ width: metrics.memPercent + '%', backgroundColor: barColor(metrics.memPercent) }"></div>
        </div>
        <span class="text-[9px] font-medium min-w-[28px] text-right">{{ metrics.memPercent }}%</span>
      </div>
      <div v-if="data.config?.template" class="col-span-2 flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">Template</span>
        <span class="font-medium ml-auto truncate max-w-[100px]">{{ data.config.template }}</span>
      </div>
    </div>
    <div v-else class="grid grid-cols-2 gap-1.5 text-xs">
      <div v-if="data.config?.cpu" class="flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">CPU</span>
        <span class="font-medium ml-auto">{{ data.config.cpu }}</span>
      </div>
      <div v-if="data.config?.memory" class="flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">RAM</span>
        <span class="font-medium ml-auto">{{ data.config.memory }}</span>
      </div>
      <div v-if="data.config?.template" class="col-span-2 flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">Template</span>
        <span class="font-medium ml-auto truncate max-w-[100px]">{{ data.config.template }}</span>
      </div>
    </div>

    <!-- Unprivileged Badge -->
    <div v-if="data.config?.unprivileged" class="mt-2">
      <span class="badge badge-success badge-sm">Unprivileged</span>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Top" class="!w-3 !h-3 !bg-cyan-500 !border-2 !border-cyan-600" />
    <Handle type="source" :position="Position.Bottom" class="!w-3 !h-3 !bg-cyan-500 !border-2 !border-cyan-600" />
  </div>
</template>

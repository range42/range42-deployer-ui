<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'
import { getTagColor } from '@/constants/tags'
import { usePendingChanges } from '@/composables/usePendingChanges'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

const props = defineProps(['data', 'selected'])

const nodeDataRef = computed(() => props.data || {})
const { hasPendingChanges, pendingCount } = usePendingChanges(nodeDataRef)

const emit = defineEmits(['open-apply-dialog'])

// Map status values to color scheme
const statusView = computed(() =>
  resolveNodeStatus(props.data?.status, props.data?.pendingAction),
)
const statusColor = computed(() => statusView.value.dotColor)

const isDeployed = computed(() => !!props.data?.deployed)
const ramMB = computed(() => {
  const m = props.data?.config?.memory
  return m ? parseInt(m) : 0
})
const displayTags = computed(() => {
  const tags = (props.data?.deployed && props.data?.desiredConfig?.tags)
    ? props.data.desiredConfig.tags
    : (props.data?.tags || [])
  return tags.slice(0, 3)
})
const overflowCount = computed(() => {
  const tags = (props.data?.deployed && props.data?.desiredConfig?.tags)
    ? props.data.desiredConfig.tags
    : (props.data?.tags || [])
  return Math.max(0, tags.length - 3)
})

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
    :class="{ 'is-selected': selected }"
  >
    <!-- Header -->
    <div class="node-header">
      <div class="node-identity">
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <AppIcon name="monitor" class="w-5 h-5" />
        </div>
        <div>
          <div :title="data?.config?.name" class="node-title">
            {{ data.config?.name || 'Virtual Machine' }}
          </div>
          <div class="text-[11px] text-base-content/75 uppercase tracking-wide">
            {{ isDeployed ? `VM #${data.config?.vmid}` : 'VM' }}
          </div>
        </div>
      </div>
      <!-- Status indicator -->
      <div class="node-status flex items-center gap-1.5">
        <span v-if="data?.pendingAction" class="text-[11px] opacity-70 capitalize">{{ statusView.label }}</span>
        <span v-if="isDeployed && !data?.pendingAction" class="text-[11px] font-medium uppercase tracking-wider" :class="{
          'text-success': statusColor === 'green',
          'text-error': statusColor === 'red',
          'text-warning': statusColor === 'orange',
          'text-base-content/75': statusColor === 'gray',
          'text-info': statusColor === 'blue',
        }">{{ data.status }}</span>
        <div
          class="w-2.5 h-2.5 rounded-full"
          :class="{
            'bg-success shadow-[0_0_6px_theme(colors.success)]': statusColor === 'green',
            'bg-error shadow-[0_0_6px_theme(colors.error)]': statusColor === 'red',
            'bg-warning shadow-[0_0_6px_theme(colors.warning)]': statusColor === 'orange',
            'bg-base-content/30': statusColor === 'gray',
            'bg-info shadow-[0_0_6px_theme(colors.info)]': statusColor === 'blue',
            'animate-pulse': statusView.pulse,
          }"
        ></div>
      </div>
    </div>

    <!-- Tags -->
    <div v-if="displayTags.length" class="flex gap-1 flex-wrap mb-1.5">
      <span
        v-for="tag in displayTags"
        :key="tag"
        class="node-tag" :title="tag"
        :style="{ '--tag-accent': getTagColor(tag).hex }"
      >{{ tag }}</span>
      <span v-if="overflowCount > 0" class="text-[11px] text-base-content/75">+{{ overflowCount }}</span>
    </div>

    <!-- Live metrics (running) or static specs (stopped) -->
    <div v-if="metrics" class="grid grid-cols-2 gap-1 text-[11px]">
      <div class="flex items-center gap-1 px-1.5 py-0.5">
        <span class="text-base-content/75 text-[11px]">CPU</span>
        <div class="flex-1 h-1 bg-base-content/10 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-[width] duration-500" :style="{ width: metrics.cpu + '%', backgroundColor: barColor(metrics.cpu) }"></div>
        </div>
        <span class="text-[11px] font-medium min-w-[28px] text-right">{{ Math.round(metrics.cpu) }}%</span>
      </div>
      <div class="flex items-center gap-1 px-1.5 py-0.5">
        <span class="text-base-content/75 text-[11px]">RAM</span>
        <div class="flex-1 h-1 bg-base-content/10 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-[width] duration-500" :style="{ width: metrics.memPercent + '%', backgroundColor: barColor(metrics.memPercent) }"></div>
        </div>
        <span class="text-[11px] font-medium min-w-[28px] text-right">{{ metrics.memPercent }}%</span>
      </div>
    </div>
    <div v-else class="grid grid-cols-2 gap-1 text-[11px]">
      <div v-if="data.config?.cores" class="flex items-center gap-1 bg-base-200/50 rounded px-1.5 py-0.5">
        <span class="text-base-content/75">CPU</span>
        <span class="font-medium ml-auto">{{ data.config.cores }}c</span>
      </div>
      <div v-if="ramMB" class="flex items-center gap-1 bg-base-200/50 rounded px-1.5 py-0.5">
        <span class="text-base-content/75">RAM</span>
        <span class="font-medium ml-auto">{{ ramMB >= 1024 ? (ramMB / 1024).toFixed(1) + 'G' : ramMB + 'M' }}</span>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Top" class="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-600" />
    <Handle type="source" :position="Position.Bottom" class="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-600" />

    <!-- Pending changes strip -->
    <div
      v-if="hasPendingChanges"
      class="flex items-center justify-between px-2 py-0.5 mt-1.5 -mx-3 -mb-3 rounded-b-xl bg-amber-500/15 border-t border-amber-500/25"
    >
      <span class="text-[11px] font-medium text-amber-800 dark:text-amber-200">
        {{ pendingCount }} unsaved
      </span>
      <button
        type="button" class="nodrag nopan rounded px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
        @click.stop="emit('open-apply-dialog')"
      >Apply</button>
    </div>
  </div>
</template>

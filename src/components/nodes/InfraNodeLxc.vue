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
</script>

<template>
  <div
    class="rounded-lg shadow-md p-3 min-w-[170px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-sky-50 to-cyan-50 dark:from-sky-950/40 dark:to-cyan-950/40': true,
      'border-sky-400 shadow-lg shadow-sky-200/50 dark:shadow-sky-900/30': selected,
      'border-sky-200 dark:border-sky-800 hover:border-sky-300 dark:hover:border-sky-700': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-lg">📦</span>
      </div>
      <div class="text-xs bg-sky-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        LXC
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-1">
      <div class="font-semibold text-sm text-sky-900 dark:text-sky-100">
        {{ data.config?.name || 'LXC Container' }}
      </div>
      <div class="text-xs text-sky-700/80 dark:text-sky-300/70 space-y-0.5">
        <div v-if="data.config?.template" class="flex items-center gap-1">
          <span class="opacity-60">Template:</span>
          <span class="font-medium">{{ data.config.template }}</span>
        </div>
        <div v-if="data.config?.cpu" class="flex items-center gap-1">
          <span class="opacity-60">CPU:</span>
          <span class="font-medium">{{ data.config.cpu }} cores</span>
        </div>
        <div v-if="data.config?.memory" class="flex items-center gap-1">
          <span class="opacity-60">RAM:</span>
          <span class="font-medium">{{ data.config.memory }}</span>
        </div>
        <div v-if="data.config?.rootfs" class="flex items-center gap-1">
          <span class="opacity-60">Disk:</span>
          <span class="font-medium">{{ data.config.rootfs }}</span>
        </div>
      </div>
    </div>

    <!-- Unprivileged Badge -->
    <div v-if="data.config?.unprivileged" class="mt-2">
      <span class="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
        Unprivileged
      </span>
    </div>

    <!-- Connection Handles - Sky blue themed -->
    <Handle type="target" :position="Position.Top" class="!bg-sky-500 !border-sky-700 !border-2" />
    <Handle type="source" :position="Position.Bottom" class="!bg-sky-500 !border-sky-700 !border-2" />
  </div>
</template>

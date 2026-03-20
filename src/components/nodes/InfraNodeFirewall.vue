<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'

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
    class="rounded-lg shadow-md p-4 min-w-[180px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-orange-50 via-red-50 to-rose-50 dark:from-orange-950/40 dark:via-red-950/30 dark:to-rose-950/30': true,
      'border-orange-400 shadow-lg shadow-orange-200/50 dark:shadow-orange-900/30': selected,
      'border-orange-200 dark:border-orange-900 hover:border-orange-300 dark:hover:border-orange-800': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon name="flame" class="w-6 h-6" />
      </div>
      <div class="text-xs bg-orange-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        Firewall
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-semibold text-sm text-orange-900 dark:text-orange-100">
        {{ data.config?.name || 'Firewall' }}
      </div>
      <div class="text-xs text-orange-700/80 dark:text-orange-300/70 space-y-1">
        <div v-if="data.config?.zones?.length" class="flex items-center gap-1">
          <span class="opacity-60">Zones:</span>
          <span class="font-medium">{{ data.config.zones.length }}</span>
        </div>
        <div v-if="data.config?.rules?.length" class="flex items-center gap-1">
          <span class="opacity-60">Rules:</span>
          <span class="font-medium">{{ data.config.rules.length }}</span>
        </div>
        <div v-if="data.config?.natEnabled" class="inline-block">
          <span class="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded font-medium">
            NAT
          </span>
        </div>
      </div>
    </div>

    <!-- Connection Handles with security colors -->
    <Handle type="target" :position="Position.Left" class="!bg-red-500 !border-red-700 !border-2 !w-4 !h-4" />
    <Handle type="source" :position="Position.Right" class="!bg-green-500 !border-green-700 !border-2 !w-4 !h-4" />
  </div>
</template>
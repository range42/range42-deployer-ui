<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps(['data', 'selected'])

// Map status values to color scheme
const statusColor = computed(() => {
  switch (props.data?.status) {
    case 'running':
    case 'green':
      return 'green'
    case 'stopped':
    case 'gray':
      return 'gray'
    case 'paused':
    case 'orange':
      return 'orange'
    case 'error':
    case 'red':
      return 'red'
    case 'deploying':
    case 'blue':
      return 'blue'
    default:
      return 'gray'
  }
})

const isDeployed = computed(() => !!props.data?.deployed)
const ramMB = computed(() => {
  const m = props.data?.config?.memory
  return m ? parseInt(m) : 0
})
</script>

<template>
  <div
    class="infra-node"
    :class="[{ 'ring-2 ring-primary ring-offset-2': selected }]"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <span class="text-lg">🖥️</span>
        </div>
        <div>
          <div class="font-semibold text-sm leading-tight">
            {{ data.config?.name || 'Virtual Machine' }}
          </div>
          <div class="text-[10px] text-base-content/50 uppercase tracking-wide">
            {{ isDeployed ? `VM #${data.config?.vmid}` : 'VM' }}
          </div>
        </div>
      </div>
      <!-- Status indicator -->
      <div class="flex items-center gap-1.5">
        <span v-if="isDeployed" class="text-[9px] font-medium uppercase tracking-wider" :class="{
          'text-success': statusColor === 'green',
          'text-error': statusColor === 'red',
          'text-warning': statusColor === 'orange',
          'text-base-content/40': statusColor === 'gray',
          'text-info': statusColor === 'blue',
        }">{{ data.status }}</span>
        <div
          class="w-2.5 h-2.5 rounded-full"
          :class="{
            'bg-success shadow-[0_0_6px_theme(colors.success)]': statusColor === 'green',
            'bg-error shadow-[0_0_6px_theme(colors.error)]': statusColor === 'red',
            'bg-warning shadow-[0_0_6px_theme(colors.warning)] animate-pulse': statusColor === 'orange',
            'bg-base-content/30': statusColor === 'gray',
            'bg-info shadow-[0_0_6px_theme(colors.info)] animate-pulse': statusColor === 'blue',
          }"
        ></div>
      </div>
    </div>

    <!-- Specs -->
    <div class="grid grid-cols-2 gap-1 text-[11px]">
      <div v-if="data.config?.cores" class="flex items-center gap-1 bg-base-200/50 rounded px-1.5 py-0.5">
        <span class="text-base-content/40">CPU</span>
        <span class="font-medium ml-auto">{{ data.config.cores }}c</span>
      </div>
      <div v-if="ramMB" class="flex items-center gap-1 bg-base-200/50 rounded px-1.5 py-0.5">
        <span class="text-base-content/40">RAM</span>
        <span class="font-medium ml-auto">{{ ramMB >= 1024 ? (ramMB / 1024).toFixed(1) + 'G' : ramMB + 'M' }}</span>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Top" class="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-600" />
    <Handle type="source" :position="Position.Bottom" class="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-600" />
  </div>
</template>

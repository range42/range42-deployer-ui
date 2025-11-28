<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps(['data', 'selected'])

const statusClass = computed(() => {
  const status = props.data?.status || 'gray'
  return `status-${status}`
})
</script>

<template>
  <div
    class="infra-node"
    :class="[statusClass, { 'ring-2 ring-primary ring-offset-2': selected }]"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-2.5">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <span class="text-lg">🖥️</span>
        </div>
        <div>
          <div class="font-semibold text-sm">
            {{ data.config?.name || 'Virtual Machine' }}
          </div>
          <div class="text-[10px] text-base-content/50 uppercase tracking-wide">VM</div>
        </div>
      </div>
      <div :class="`status-dot ${data?.status || 'gray'}`"></div>
    </div>

    <!-- Specs -->
    <div class="grid grid-cols-2 gap-1.5 text-xs">
      <div v-if="data.config?.cpu" class="flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">CPU</span>
        <span class="font-medium ml-auto">{{ data.config.cpu }}</span>
      </div>
      <div v-if="data.config?.memory" class="flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">RAM</span>
        <span class="font-medium ml-auto">{{ data.config.memory }}</span>
      </div>
      <div v-if="data.config?.os" class="col-span-2 flex items-center gap-1 bg-base-200/50 rounded px-2 py-1">
        <span class="text-base-content/50">OS</span>
        <span class="font-medium ml-auto truncate max-w-[100px]">{{ data.config.os }}</span>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle type="target" :position="Position.Top" class="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-600" />
    <Handle type="source" :position="Position.Bottom" class="!w-3 !h-3 !bg-blue-500 !border-2 !border-blue-600" />
  </div>
</template>
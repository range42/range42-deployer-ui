<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'

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
    class="group-container relative w-full h-full"
    :class="{
      'ring-2 ring-slate-500 ring-offset-2': selected,
      'shadow-xl': selected,
    }"
  >
    <!-- Node Resizer -->
    <NodeResizer 
      min-width="350" 
      min-height="250" 
      max-width="1200" 
      max-height="900"
    />

    <!-- Group Background - Neutral slate/gray theme -->
    <div 
      class="absolute inset-0 rounded-xl transition-all duration-200 border-2 border-dashed"
      :class="{
        'bg-gradient-to-br from-slate-100/80 via-gray-50/50 to-slate-100/80 dark:from-slate-800/40 dark:via-gray-900/30 dark:to-slate-800/40': true,
        'border-slate-400/60 dark:border-slate-500/50': true,
        'hover:from-slate-200/80 hover:via-gray-100/50 hover:to-slate-200/80 dark:hover:from-slate-700/40 dark:hover:via-gray-800/30 dark:hover:to-slate-700/40': true,
      }"
    />

    <!-- Corner Accent -->
    <div class="absolute top-0 left-0 w-12 h-12 bg-gradient-to-br from-slate-400/20 to-transparent rounded-tl-xl" />
    <div class="absolute bottom-0 right-0 w-12 h-12 bg-gradient-to-tl from-slate-400/20 to-transparent rounded-br-xl" />

    <!-- Group Header -->
    <div class="absolute top-4 left-5 right-5 flex items-center justify-between pointer-events-none z-10">
      <div class="flex items-center space-x-3">
        <div :class="`w-4 h-4 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-xl">📁</span>
        <div>
          <div class="text-base font-bold text-slate-800 dark:text-slate-200">
            {{ data.config?.name || 'Group' }}
          </div>
          <div v-if="data.config?.description" class="text-xs text-slate-600/80 dark:text-slate-300/70 max-w-[200px] truncate">
            {{ data.config.description }}
          </div>
        </div>
      </div>
      <div class="px-3 py-1.5 bg-slate-600/90 text-white text-xs font-semibold uppercase tracking-wider rounded-full shadow-lg">
        Group
      </div>
    </div>

    <!-- Tags -->
    <div v-if="data.config?.tags?.length" class="absolute top-16 left-5 flex flex-wrap gap-1 z-10">
      <span 
        v-for="tag in data.config.tags.slice(0, 3)" 
        :key="tag"
        class="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full"
      >
        {{ tag }}
      </span>
      <span v-if="data.config.tags.length > 3" class="text-xs text-slate-500">
        +{{ data.config.tags.length - 3 }}
      </span>
    </div>

    <!-- Resource Pool Badge -->
    <div v-if="data.config?.resourcePool" class="absolute top-16 right-5 z-10">
      <div class="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-md font-medium">
        Pool: {{ data.config.resourcePool }}
      </div>
    </div>

    <!-- Drop Zone Hint -->
    <div 
      v-if="!data.hasChildren" 
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-5"
    >
      <div class="text-center opacity-40 mt-10">
        <div class="text-4xl mb-2">📦</div>
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-300">Drop components here</div>
        <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">Networks, VMs, services...</div>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle 
      type="target" 
      :position="Position.Top" 
      class="!bg-slate-500 !border-2 !border-slate-700 !w-4 !h-4 !rounded-full"
      :style="{ top: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Bottom" 
      class="!bg-slate-500 !border-2 !border-slate-700 !w-4 !h-4 !rounded-full"
      :style="{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
  </div>
</template>

<style scoped>
.group-container {
  min-width: 350px;
  min-height: 250px;
}

.group-container * {
  transition: all 0.2s ease;
}
</style>

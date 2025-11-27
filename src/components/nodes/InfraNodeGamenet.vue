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
    class="gamenet-container relative w-full h-full"
    :class="{
      'ring-2 ring-purple-500 ring-offset-2': selected,
      'shadow-xl': selected,
    }"
  >
    <!-- Node Resizer -->
    <NodeResizer 
      min-width="400" 
      min-height="300" 
      max-width="1200" 
      max-height="900"
    />

    <!-- Gamenet Background - Purple theme for Cyber Range -->
    <div 
      class="absolute inset-0 rounded-xl transition-all duration-200 border-3 border-dashed"
      :class="{
        'bg-gradient-to-br from-purple-500/10 via-violet-500/5 to-purple-600/10': true,
        'border-purple-400/60 dark:border-purple-500/50': true,
        'hover:from-purple-500/15 hover:via-violet-500/10 hover:to-purple-600/15': true,
      }"
    />

    <!-- Corner Accent -->
    <div class="absolute top-0 left-0 w-16 h-16 bg-gradient-to-br from-purple-500/30 to-transparent rounded-tl-xl" />
    <div class="absolute bottom-0 right-0 w-16 h-16 bg-gradient-to-tl from-purple-500/30 to-transparent rounded-br-xl" />

    <!-- Gamenet Header -->
    <div class="absolute top-4 left-5 right-5 flex items-center justify-between pointer-events-none z-10">
      <div class="flex items-center space-x-3">
        <div :class="`w-4 h-4 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-2xl">🎮</span>
        <div>
          <div class="text-base font-bold text-purple-800 dark:text-purple-200">
            {{ data.config?.name || 'Cyber Range' }}
          </div>
          <div class="text-xs text-purple-600/80 dark:text-purple-300/70">
            {{ data.config?.bridgePrefix ? `Prefix: ${data.config.bridgePrefix}` : 'Isolated Environment' }}
          </div>
        </div>
      </div>
      <div class="px-3 py-1.5 bg-purple-600/90 text-white text-xs font-semibold uppercase tracking-wider rounded-full shadow-lg">
        Gamenet
      </div>
    </div>

    <!-- Resource Pool Badge -->
    <div v-if="data.config?.resourcePool" class="absolute top-16 left-5 z-10">
      <div class="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-1 rounded-md font-medium">
        Pool: {{ data.config.resourcePool }}
      </div>
    </div>

    <!-- Description -->
    <div v-if="data.config?.description" class="absolute top-16 right-5 max-w-[200px] z-10">
      <div class="text-xs bg-white/80 dark:bg-base-300/80 text-base-content px-2 py-1 rounded backdrop-blur-sm line-clamp-2">
        {{ data.config.description }}
      </div>
    </div>

    <!-- Drop Zone Hint -->
    <div 
      v-if="!data.hasChildren" 
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-5"
    >
      <div class="text-center opacity-50 mt-10">
        <div class="text-5xl mb-3">🏰</div>
        <div class="text-sm font-semibold text-purple-700 dark:text-purple-300">Drop infrastructure here</div>
        <div class="text-xs text-purple-600/70 dark:text-purple-400/70 mt-1">Networks, VMs, firewalls...</div>
      </div>
    </div>

    <!-- Connection Handles - Purple themed -->
    <Handle 
      type="target" 
      :position="Position.Top" 
      class="!bg-purple-500 !border-2 !border-purple-700 !w-4 !h-4 !rounded-full"
      :style="{ top: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Bottom" 
      class="!bg-purple-500 !border-2 !border-purple-700 !w-4 !h-4 !rounded-full"
      :style="{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
  </div>
</template>

<style scoped>
.gamenet-container {
  min-width: 400px;
  min-height: 300px;
}

.gamenet-container * {
  transition: all 0.2s ease;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

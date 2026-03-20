<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
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
    class="sim-internet-container relative w-full h-full"
    :class="{
      'ring-2 ring-violet-500 ring-offset-2': selected,
      'shadow-xl': selected,
    }"
  >
    <!-- Node Resizer -->
    <NodeResizer 
      min-width="350" 
      min-height="200" 
      max-width="800" 
      max-height="500"
    />

    <!-- Simulated Internet Background - Deep violet/indigo theme -->
    <div 
      class="absolute inset-0 rounded-xl transition-all duration-200 border-2 border-dashed"
      :class="{
        'bg-gradient-to-br from-indigo-600/15 via-violet-500/10 to-purple-600/15': true,
        'border-indigo-400/60 dark:border-indigo-500/50': true,
        'hover:from-indigo-600/20 hover:via-violet-500/15 hover:to-purple-600/20': true,
      }"
    />

    <!-- Globe Pattern Overlay -->
    <div class="absolute inset-0 opacity-5 pointer-events-none">
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border-2 border-indigo-500 rounded-full" />
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-16 border-2 border-indigo-500 rounded-full" />
    </div>

    <!-- Header -->
    <div class="absolute top-4 left-5 right-5 flex items-center justify-between pointer-events-none z-10">
      <div class="flex items-center space-x-3">
        <div :class="`w-4 h-4 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon name="earth" class="w-7 h-7" />
        <div>
          <div class="text-base font-bold text-indigo-800 dark:text-indigo-200">
            {{ data.config?.name || 'Simulated Internet' }}
          </div>
          <div class="text-xs text-indigo-600/80 dark:text-indigo-300/70">
            Fake Public Network
          </div>
        </div>
      </div>
      <div class="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-semibold uppercase tracking-wider rounded-full shadow-lg">
        WAN
      </div>
    </div>

    <!-- Network Info -->
    <div class="absolute top-16 left-5 space-y-1 z-10">
      <div v-if="data.config?.publicCidr" class="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-md font-medium inline-block">
        {{ data.config.publicCidr }}
      </div>
      <div v-if="data.config?.fakeDns" class="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-md font-medium inline-block ml-1">
        DNS: {{ data.config.fakeDns }}
      </div>
    </div>

    <!-- Services List -->
    <div v-if="data.config?.services?.length" class="absolute bottom-4 left-5 right-5 z-10">
      <div class="flex flex-wrap gap-1">
        <span 
          v-for="service in data.config.services.slice(0, 4)" 
          :key="service"
          class="text-xs bg-white/80 dark:bg-base-300/80 text-base-content px-2 py-0.5 rounded"
        >
          {{ service }}
        </span>
        <span v-if="data.config.services.length > 4" class="text-xs text-indigo-600">
          +{{ data.config.services.length - 4 }} more
        </span>
      </div>
    </div>

    <!-- Drop Zone Hint -->
    <div 
      v-if="!data.hasChildren && !data.config?.services?.length" 
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-5"
    >
      <div class="text-center opacity-50 mt-8">
        <AppIcon name="cloud" class="w-10 h-10 mx-auto mb-2" />
        <div class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Fake Internet Services</div>
        <div class="text-xs text-indigo-600/70 dark:text-indigo-400/70">DNS, CDN, Attacker C2...</div>
      </div>
    </div>

    <!-- Connection Handles - Indigo themed -->
    <Handle 
      type="target" 
      :position="Position.Top" 
      class="!bg-indigo-500 !border-2 !border-indigo-700 !w-4 !h-4 !rounded-full"
      :style="{ top: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Bottom" 
      class="!bg-indigo-500 !border-2 !border-indigo-700 !w-4 !h-4 !rounded-full"
      :style="{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Left" 
      class="!bg-violet-500 !border-2 !border-violet-700 !w-4 !h-4 !rounded-full"
      :style="{ left: '-8px', top: '50%', transform: 'translateY(-50%)' }"
    />
    <Handle 
      type="source" 
      :position="Position.Right" 
      class="!bg-violet-500 !border-2 !border-violet-700 !w-4 !h-4 !rounded-full"
      :style="{ right: '-8px', top: '50%', transform: 'translateY(-50%)' }"
    />
  </div>
</template>

<style scoped>
.sim-internet-container {
  min-width: 350px;
  min-height: 200px;
}

.sim-internet-container * {
  transition: all 0.2s ease;
}
</style>

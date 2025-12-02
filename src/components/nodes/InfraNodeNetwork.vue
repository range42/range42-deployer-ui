<script setup>
/**
 * Network Segment Node
 * 
 * Represents a Proxmox bridge (L2 broadcast domain).
 * Devices connect TO this node via edges - it's a connection point, not a container.
 * 
 * Visual design inspired by network diagrams - looks like a network cloud/switch.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps(['data', 'selected', 'connectable'])

const statusColor = computed(() => {
  switch (props.data?.status) {
    case 'gray': return 'bg-slate-400'
    case 'orange': return 'bg-amber-400'
    case 'green': return 'bg-emerald-400'
    case 'red': return 'bg-red-400'
    default: return 'bg-slate-400'
  }
})

const statusRing = computed(() => {
  switch (props.data?.status) {
    case 'green': return 'ring-emerald-400/50'
    case 'orange': return 'ring-amber-400/50'
    case 'red': return 'ring-red-400/50'
    default: return 'ring-slate-400/30'
  }
})

// Parse CIDR to show network and prefix separately
const networkInfo = computed(() => {
  const cidr = props.data?.config?.cidr
  if (!cidr) return null
  const [network, prefix] = cidr.split('/')
  return { network, prefix: `/${prefix}` }
})

// Get segment type badge color
const segmentTypeColor = computed(() => {
  const type = props.data?.config?.segmentType || 'lan'
  const colors = {
    wan: 'bg-red-500/90 text-white',
    dmz: 'bg-amber-500/90 text-white', 
    lan: 'bg-blue-500/90 text-white',
    management: 'bg-purple-500/90 text-white',
    custom: 'bg-slate-500/90 text-white'
  }
  return colors[type] || colors.custom
})
</script>

<template>
  <div
    class="network-segment-node"
    :class="{
      'ring-2 ring-primary ring-offset-2 shadow-xl': selected,
      'shadow-md hover:shadow-lg': !selected,
    }"
  >
    <!-- Main Card -->
    <div class="relative bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 dark:from-sky-950/60 dark:via-blue-950/50 dark:to-indigo-950/40 rounded-xl border-2 border-sky-200 dark:border-sky-800 overflow-hidden min-w-[220px]">
      
      <!-- Top accent bar with network pattern -->
      <div class="h-2 bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 relative overflow-hidden">
        <div class="absolute inset-0 opacity-30">
          <svg class="w-full h-full" viewBox="0 0 100 8" preserveAspectRatio="none">
            <pattern id="netPattern" patternUnits="userSpaceOnUse" width="20" height="8">
              <circle cx="2" cy="4" r="1" fill="white"/>
              <circle cx="10" cy="4" r="1" fill="white"/>
              <circle cx="18" cy="4" r="1" fill="white"/>
            </pattern>
            <rect width="100" height="8" fill="url(#netPattern)"/>
          </svg>
        </div>
      </div>

      <!-- Header -->
      <div class="px-4 pt-3 pb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <!-- Network Icon with status ring -->
            <div class="relative flex-shrink-0">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-100 to-blue-200 dark:from-sky-900 dark:to-blue-800 flex items-center justify-center shadow-sm">
                <svg class="w-6 h-6 text-blue-600 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                </svg>
              </div>
              <!-- Status dot -->
              <div :class="`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${statusColor} ring-2 ring-white dark:ring-slate-800`"></div>
            </div>

            <!-- Name & Type -->
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                {{ data.config?.name || data.label || 'Network Segment' }}
              </div>
              <div class="text-[10px] text-slate-500 dark:text-slate-400 font-medium tracking-wide">
                L2 BROADCAST DOMAIN
              </div>
            </div>
          </div>

          <!-- Segment Type Badge -->
          <div :class="`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex-shrink-0 ${segmentTypeColor}`">
            {{ data.config?.segmentType || 'LAN' }}
          </div>
        </div>
      </div>

      <!-- Network Details Grid -->
      <div class="px-4 pb-3 space-y-2">
        <!-- Bridge & VLAN Row -->
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-md px-2.5 py-1.5 flex-1">
            <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span class="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              {{ data.config?.bridge || 'vmbr0' }}
            </span>
          </div>
          <div v-if="data.config?.vlan" class="flex items-center gap-1 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-md px-2 py-1.5">
            <span class="text-[10px] font-medium">VLAN</span>
            <span class="text-xs font-mono font-bold">{{ data.config.vlan }}</span>
          </div>
        </div>

        <!-- CIDR Display -->
        <div v-if="networkInfo" class="bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40 rounded-lg px-3 py-2">
          <div class="flex items-center justify-between">
            <div class="flex items-baseline gap-1">
              <span class="text-lg font-mono font-bold text-blue-700 dark:text-blue-300">
                {{ networkInfo.network }}
              </span>
              <span class="text-sm font-mono font-semibold text-blue-500 dark:text-blue-400">
                {{ networkInfo.prefix }}
              </span>
            </div>
            <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          </div>
        </div>

        <!-- Gateway Row -->
        <div v-if="data.config?.gateway" class="flex items-center gap-2 text-xs">
          <div class="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-md px-2.5 py-1.5 flex-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            <span class="font-medium">Gateway</span>
            <span class="font-mono font-bold ml-auto">{{ data.config.gateway }}</span>
          </div>
        </div>

        <!-- Description (if set) -->
        <div v-if="data.config?.description" class="text-[11px] text-slate-500 dark:text-slate-400 leading-tight line-clamp-2 italic">
          {{ data.config.description }}
        </div>
      </div>

      <!-- Bottom connection indicator bar -->
      <div class="h-1 bg-gradient-to-r from-transparent via-sky-300 dark:via-sky-600 to-transparent"></div>
    </div>

    <!-- Connection Handles - Multiple on each side for many connections -->
    <!-- Top handles -->
    <Handle 
      id="top-1"
      type="target" 
      :position="Position.Top" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ top: '-6px', left: '25%' }"
    />
    <Handle 
      id="top-2"
      type="target" 
      :position="Position.Top" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ top: '-6px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      id="top-3"
      type="target" 
      :position="Position.Top" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ top: '-6px', left: '75%' }"
    />

    <!-- Bottom handles -->
    <Handle 
      id="bottom-1"
      type="target" 
      :position="Position.Bottom" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ bottom: '-6px', left: '25%' }"
    />
    <Handle 
      id="bottom-2"
      type="target" 
      :position="Position.Bottom" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ bottom: '-6px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle 
      id="bottom-3"
      type="target" 
      :position="Position.Bottom" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ bottom: '-6px', left: '75%' }"
    />

    <!-- Left handles -->
    <Handle 
      id="left-1"
      type="target" 
      :position="Position.Left" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ left: '-6px', top: '35%' }"
    />
    <Handle 
      id="left-2"
      type="target" 
      :position="Position.Left" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ left: '-6px', top: '65%' }"
    />

    <!-- Right handles -->
    <Handle 
      id="right-1"
      type="target" 
      :position="Position.Right" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ right: '-6px', top: '35%' }"
    />
    <Handle 
      id="right-2"
      type="target" 
      :position="Position.Right" 
      class="!bg-sky-500 !border-2 !border-sky-600 !w-3 !h-3 !rounded-full hover:!scale-125 transition-transform"
      :style="{ right: '-6px', top: '65%' }"
    />
  </div>
</template>

<style scoped>
.network-segment-node {
  transition: all 0.2s ease;
}

.network-segment-node:hover {
  transform: translateY(-1px);
}

/* Handle visibility on hover */
.network-segment-node :deep(.vue-flow__handle) {
  opacity: 0.6;
  transition: all 0.15s ease;
}

.network-segment-node:hover :deep(.vue-flow__handle) {
  opacity: 1;
}

/* Line clamp for description */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
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

const applianceIcon = computed(() => {
  const type = props.data.config?.applianceType || 'pfsense'
  switch (type) {
    case 'pfsense': return '🔥'
    case 'opnsense': return '🛡️'
    case 'sophos': return '⚔️'
    case 'fortigate': return '🏰'
    default: return '🛡️'
  }
})
</script>

<template>
  <div
    class="rounded-xl shadow-lg p-4 min-w-[200px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 dark:from-emerald-950/50 dark:via-teal-950/40 dark:to-cyan-950/40': true,
      'border-emerald-400 shadow-xl shadow-emerald-200/50 dark:shadow-emerald-900/30 ring-2 ring-emerald-300/50': selected,
      'border-emerald-300 dark:border-emerald-800 hover:border-emerald-400 dark:hover:border-emerald-700': !selected,
    }"
  >
    <!-- Status & Icon Row -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-4 h-4 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-2xl">{{ applianceIcon }}</span>
      </div>
      <div class="px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold uppercase tracking-wider rounded-full shadow">
        Edge FW
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-bold text-base text-emerald-900 dark:text-emerald-100">
        {{ data.config?.name || 'Edge Firewall' }}
      </div>
      
      <div class="text-xs text-emerald-700/80 dark:text-emerald-300/70 space-y-1">
        <div v-if="data.config?.applianceType" class="flex items-center gap-2">
          <span class="opacity-60">Appliance:</span>
          <span class="font-semibold uppercase">{{ data.config.applianceType }}</span>
        </div>
        
        <!-- WAN Interface -->
        <div v-if="data.config?.wanIp" class="flex items-center gap-2 bg-red-100/50 dark:bg-red-900/30 px-2 py-1 rounded">
          <span class="text-red-600 dark:text-red-400 font-medium">WAN:</span>
          <span class="font-mono text-xs">{{ data.config.wanIp }}</span>
        </div>
        
        <!-- LAN Interface -->
        <div v-if="data.config?.lanIp" class="flex items-center gap-2 bg-green-100/50 dark:bg-green-900/30 px-2 py-1 rounded">
          <span class="text-green-600 dark:text-green-400 font-medium">LAN:</span>
          <span class="font-mono text-xs">{{ data.config.lanIp }}</span>
        </div>
        
        <!-- DMZ Interface -->
        <div v-if="data.config?.dmzIp" class="flex items-center gap-2 bg-orange-100/50 dark:bg-orange-900/30 px-2 py-1 rounded">
          <span class="text-orange-600 dark:text-orange-400 font-medium">DMZ:</span>
          <span class="font-mono text-xs">{{ data.config.dmzIp }}</span>
        </div>
      </div>
    </div>

    <!-- Feature Badges -->
    <div class="mt-3 flex flex-wrap gap-1">
      <span v-if="data.config?.natEnabled" class="text-xs bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded font-medium">
        NAT
      </span>
      <span v-if="data.config?.vpnEnabled" class="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-medium">
        VPN
      </span>
      <span v-if="data.config?.idsEnabled" class="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-medium">
        IDS/IPS
      </span>
    </div>

    <!-- Connection Handles -->
    <!-- WAN (external/untrusted) - Red on left -->
    <Handle 
      type="target" 
      :position="Position.Left" 
      id="wan"
      class="!bg-red-500 !border-2 !border-red-700 !w-4 !h-4 !rounded-full"
      :style="{ left: '-8px', top: '30%' }"
    />
    <!-- LAN (internal/trusted) - Green on right -->
    <Handle 
      type="source" 
      :position="Position.Right" 
      id="lan"
      class="!bg-green-500 !border-2 !border-green-700 !w-4 !h-4 !rounded-full"
      :style="{ right: '-8px', top: '30%' }"
    />
    <!-- DMZ - Orange on right bottom -->
    <Handle 
      type="source" 
      :position="Position.Right" 
      id="dmz"
      class="!bg-orange-500 !border-2 !border-orange-700 !w-4 !h-4 !rounded-full"
      :style="{ right: '-8px', top: '60%' }"
    />
    <!-- Management/Top -->
    <Handle 
      type="target" 
      :position="Position.Top" 
      id="mgmt"
      class="!bg-blue-500 !border-2 !border-blue-700 !w-3 !h-3 !rounded-full"
    />
  </div>
</template>

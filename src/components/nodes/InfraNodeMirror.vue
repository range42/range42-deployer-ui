<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'

defineProps(['data', 'selected'])

const health = ref(null)
let pollInterval = null

const statusColor = computed(() => {
  switch (health.value?.status) {
    case 'healthy': return 'bg-green-400'
    case 'degraded': return 'bg-orange-400'
    case 'offline':
    case 'unconfigured': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
})

const backendLabel = computed(() => {
  if (!health.value) return '—'
  return health.value.backend === 'aptly' ? 'aptly (air-gapped)' : 'apt-cacher-ng'
})

async function fetchHealth() {
  try {
    const res = await fetch('/v1/infra/mirror/health')
    health.value = await res.json()
  } catch {
    health.value = { status: 'offline' }
  }
}

onMounted(() => {
  fetchHealth()
  pollInterval = setInterval(fetchHealth, 30_000)
})

onUnmounted(() => clearInterval(pollInterval))
</script>

<template>
  <div
    class="rounded-lg shadow-md p-4 min-w-[200px] border-2 transition-all duration-200"
    :class="{
      'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/40': true,
      'border-amber-400 shadow-lg shadow-amber-200/50 dark:shadow-amber-900/30': selected,
      'border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:hover:border-amber-700': !selected,
    }"
  >
    <!-- Status Indicator -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center space-x-2">
        <div :class="`w-3 h-3 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <span class="text-xl">📦</span>
      </div>
      <div class="text-xs bg-amber-500/90 text-white px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
        APT Mirror
      </div>
    </div>

    <!-- Node Content -->
    <div class="space-y-2">
      <div class="font-semibold text-sm text-amber-900 dark:text-amber-100">
        {{ data.config?.name || 'APT Mirror' }}
      </div>
      <div class="text-xs text-amber-700/80 dark:text-amber-300/70 space-y-1">
        <div class="flex items-center gap-1">
          <span class="opacity-60">Status:</span>
          <span class="font-semibold capitalize">{{ health?.status ?? 'unknown' }}</span>
        </div>
        <div v-if="health?.status === 'healthy'" class="flex items-center gap-1">
          <span class="opacity-60">Backend:</span>
          <span class="font-medium">{{ backendLabel }}</span>
        </div>
        <div v-if="data.config?.ip" class="flex items-center gap-1">
          <span class="opacity-60">IP:</span>
          <span class="font-mono text-xs">{{ data.config.ip }}</span>
        </div>
      </div>
    </div>

    <!-- Connection Handles - Amber themed -->
    <Handle type="target" :position="Position.Top" class="!bg-amber-500 !border-amber-700 !border-2" />
    <Handle type="source" :position="Position.Bottom" class="!bg-amber-500 !border-amber-700 !border-2" />
    <Handle type="source" :position="Position.Left" class="!bg-yellow-500 !border-yellow-700 !border-2" />
    <Handle type="source" :position="Position.Right" class="!bg-yellow-500 !border-yellow-700 !border-2" />
  </div>
</template>

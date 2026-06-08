<script setup>
import { computed } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import AppIcon from '@/components/icons/AppIcon.vue'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

const props = defineProps(['id', 'data', 'selected'])

// useVueFlow returns an empty shell outside of a VueFlow provider (unit-test safe
// because the composable is mocked in tests).
let findNode = () => null
try {
  const vf = useVueFlow()
  findNode = vf?.findNode || findNode
} catch {
  // Tests stub @vue-flow/core without useVueFlow; fall back to no-op resolver.
}

const VALID_HOST_TYPES = ['vm', 'lxc']

const hostRef = computed(() => props.data?.host_ref || props.data?.config?.host_ref || '')

// Node resolution is only for UI affordance — the authoritative validation
// lives in useInfraBuilder.
const hostNode = computed(() => {
  const ref = hostRef.value
  if (!ref) return null
  const n = findNode(ref)
  return n || null
})

const isValidHost = computed(() => {
  if (!hostRef.value) return false
  if (!hostNode.value) return false
  return VALID_HOST_TYPES.includes(hostNode.value.type)
})

const statusView = computed(() =>
  resolveNodeStatus(props.data?.status, props.data?.pendingAction),
)
const statusColor = computed(() => statusView.value.dotColor)
</script>

<template>
  <div
    class="infra-node relative rounded-lg border border-base-300 bg-base-100 p-3 min-w-[220px] shadow-sm"
    :class="[{ 'ring-2 ring-primary ring-offset-2': selected }]"
    :data-testid="`docker-node-${id || data?.id || ''}`"
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
          <AppIcon name="container" class="w-5 h-5" />
        </div>
        <div>
          <div class="font-semibold text-sm leading-tight">
            {{ data?.config?.name || 'Docker Container' }}
          </div>
          <div class="text-[10px] text-base-content/50 uppercase tracking-wide">
            {{ data?.config?.image || 'docker' }}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <!-- Missing-host warning — red dot surfaces Problems panel entry -->
        <span
          v-if="!isValidHost"
          class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-200"
          :data-testid="`docker-missing-host-${id || data?.id || ''}`"
          :title="hostRef
            ? `host_ref '${hostRef}' is not a VM or LXC`
            : 'Docker containers must tether to a VM or LXC host'"
        />
        <span v-if="data?.pendingAction" class="text-[10px] opacity-70 capitalize">{{ statusView.label }}</span>
        <span
          class="text-[9px] font-medium uppercase tracking-wider"
          :class="{
            'text-success': statusColor === 'green',
            'text-error': statusColor === 'red',
            'text-warning': statusColor === 'orange',
            'text-info': statusColor === 'blue',
            'text-base-content/50': statusColor === 'gray',
          }"
        >
          {{ data?.status || 'draft' }}
        </span>
      </div>
    </div>

    <!-- Host binding summary -->
    <div class="text-xs text-base-content/70 mt-1">
      <span class="font-medium">Host:</span>
      <span v-if="hostRef" class="ml-1 font-mono">{{ hostRef }}</span>
      <span v-else class="ml-1 italic text-error">unset</span>
    </div>

    <!-- Optional ports preview -->
    <div v-if="data?.config?.ports?.length" class="mt-1 flex flex-wrap gap-1">
      <span
        v-for="p in data.config.ports.slice(0, 3)"
        :key="p"
        class="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
      >
        {{ p }}
      </span>
    </div>

    <!-- Connection Handles (for network edges) -->
    <Handle
      type="target"
      :position="Position.Left"
      class="!bg-sky-500 !border-2 !border-sky-700 !w-3 !h-3"
    />
    <Handle
      type="source"
      :position="Position.Right"
      class="!bg-sky-500 !border-2 !border-sky-700 !w-3 !h-3"
    />
  </div>
</template>

<style scoped>
.infra-node {
  transition: all 0.15s ease;
}
</style>

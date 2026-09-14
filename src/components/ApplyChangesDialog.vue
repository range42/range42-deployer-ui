<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { vm as vmApi, captureBackendGuard } from '@/services/proxmox/api'
import { CONFIG_WRITE_UNAVAILABLE, observedConfig } from '@/services/proxmox/observedConfig'
import type { PendingChange } from '@/services/proxmox/types'

const props = defineProps<{
  node: { data: Record<string, unknown>; id: string; type?: string }
  pendingChanges: PendingChange[]
}>()
const emit = defineEmits<{ close: []; applied: [] }>()
const isRefreshing = ref(false)
const refreshError = ref('')
const refreshStatus = ref('')
let mounted = true
onBeforeUnmount(() => { mounted = false })
const liveChanges = computed(() => props.pendingChanges.filter(c => c.category === 'live'))
const restartChanges = computed(() => props.pendingChanges.filter(c => c.category === 'restart'))
const redeployChanges = computed(() => props.pendingChanges.filter(c => c.category === 'redeploy'))

function target() {
  const config = props.node.data.config as Record<string, unknown> | undefined
  return { id: props.node.id, vmId: Number(props.node.data.vmId), node: config?.proxmoxNode,
    vmtype: props.node.type === 'lxc' || props.node.data.type === 'lxc' ? 'lxc' as const : 'qemu' as const }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || '(none)'
  if (value === undefined || value === null) return '(none)'
  return String(value)
}

async function refreshActual() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  refreshError.value = ''
  refreshStatus.value = ''
  const selectedNode = props.node
  const selected = target()
  try {
    if (!Number.isSafeInteger(selected.vmId) || selected.vmId < 1 || typeof selected.node !== 'string' || !selected.node) {
      throw new Error('A selected guest and node are required.')
    }
    const checkBackend = captureBackendGuard()
    const raw = await vmApi.getConfig(selected.vmId, selected.vmtype, { node: selected.node })
    checkBackend()
    if (!mounted || props.node !== selectedNode || JSON.stringify(target()) !== JSON.stringify(selected)) return
    const actual = observedConfig(raw, selected.vmtype)
    props.node.data.actualConfig = actual // eslint-disable-line vue/no-mutating-props -- VueFlow nodes are reactive
    refreshStatus.value = 'Actual configuration refreshed. Desired edits are preserved.'
  } catch {
    if (mounted && props.node === selectedNode) refreshError.value = 'Could not refresh the selected guest. Check the backend, target and connection; your edits are unchanged.'
  } finally {
    if (mounted) isRefreshing.value = false
  }
}
</script>

<template>
  <div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="apply-changes-title">
    <div class="modal-box max-w-md">
      <h3 id="apply-changes-title" class="font-bold text-lg mb-4">
        Apply Changes &mdash; {{ (node.data.desiredConfig as Record<string, unknown>)?.name || node.data.label }}
      </h3>

      <!-- Live changes -->
      <div v-if="liveChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-success uppercase tracking-wider mb-1">
          Desired changes
        </div>
        <div v-for="c in liveChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">

          <span class="font-medium">{{ c.label }}:</span>
          <span class="text-base-content/50">{{ formatValue(c.actual) }}</span>
          <span>&rarr;</span>
          <span>{{ formatValue(c.desired) }}</span>
        </div>
      </div>

      <!-- Restart changes -->
      <div v-if="restartChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-warning uppercase tracking-wider mb-1">
          Requires Restart
        </div>
        <div v-for="c in restartChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">
          <span class="text-warning">&#x26A0;</span>
          <span class="font-medium">{{ c.label }}:</span>
          <span class="text-base-content/50">{{ formatValue(c.actual) }}</span>
          <span>&rarr;</span>
          <span>{{ formatValue(c.desired) }}</span>
        </div>
      </div>

      <!-- Redeploy changes -->
      <div v-if="redeployChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-error uppercase tracking-wider mb-1">
          Requires Redeployment
        </div>
        <div v-for="c in redeployChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">
          <span class="text-error">&#x26D4;</span>
          <span class="font-medium">{{ c.label }}:</span>
          <span class="text-base-content/50">{{ formatValue(c.actual) }}</span>
          <span>&rarr;</span>
          <span>{{ formatValue(c.desired) }}</span>
        </div>
      </div>

      <div class="alert alert-warning text-sm mb-4" role="note">
        <span>{{ CONFIG_WRITE_UNAVAILABLE }}</span>
      </div>
      <div v-if="refreshError" class="alert alert-error text-sm mb-4" role="alert">{{ refreshError }}</div>
      <p v-if="refreshStatus" class="text-sm mb-4" role="status">{{ refreshStatus }}</p>
      <div class="modal-action flex-wrap">
        <button class="btn btn-ghost" @click="emit('close')">Close</button>
        <button class="btn btn-outline" :disabled="isRefreshing" @click="refreshActual">
          {{ isRefreshing ? 'Refreshing…' : 'Refresh actual configuration' }}
        </button>
        <button class="btn btn-warning" disabled>Apply Changes</button>
      </div>
    </div>
    <div class="modal-backdrop" @click="emit('close')"></div>
  </div>
</template>

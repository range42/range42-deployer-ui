<script setup lang="ts">
import { ref, computed } from 'vue'
import { vm as vmApi } from '@/services/proxmox/api'
import type { PendingChange } from '@/services/proxmox/types'

const props = defineProps<{
  node: { data: Record<string, unknown>; id: string }
  pendingChanges: PendingChange[]
}>()

const emit = defineEmits<{
  close: []
  applied: []
}>()

const isApplying = ref(false)
const applyError = ref<string | null>(null)
const applyProgress = ref('')

const liveChanges = computed(() => props.pendingChanges.filter(c => c.category === 'live'))
const restartChanges = computed(() => props.pendingChanges.filter(c => c.category === 'restart'))
const redeployChanges = computed(() => props.pendingChanges.filter(c => c.category === 'redeploy'))

const needsRestart = computed(() => restartChanges.value.length > 0)
const proxmoxNode = computed(() => (props.node.data.config as Record<string, unknown>)?.proxmoxNode as string || 'pve01')
const vmId = computed(() => Number(props.node.data.vmId))
const currentStatus = computed(() => props.node.data.status as string)

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || '(none)'
  if (value === undefined || value === null) return '(none)'
  return String(value)
}

async function applyChange(change: PendingChange): Promise<void> {
  const node = proxmoxNode.value
  const id = vmId.value
  switch (change.field) {
    case 'tags':
      await vmApi.setTags(node, id, change.desired as string[])
      break
    case 'name':
      await vmApi.setName(node, id, change.desired as string)
      break
    case 'description':
      await vmApi.setDescription(node, id, change.desired as string)
      break
    case 'cores':
      await vmApi.setCpu(node, id, change.desired as number)
      break
    case 'memory':
      await vmApi.setMemory(node, id, change.desired as number)
      break
  }
}

function waitForStatus(targetStatus: string, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (props.node.data.status === targetStatus) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for ${targetStatus}`))
      setTimeout(check, 2000)
    }
    check()
  })
}

async function handleApply() {
  isApplying.value = true
  applyError.value = null

  try {
    // 1. Apply live changes
    if (liveChanges.value.length > 0) {
      applyProgress.value = 'Applying live changes...'
      await Promise.all(liveChanges.value.map(c => applyChange(c)))
    }

    // 2. Apply restart changes
    if (restartChanges.value.length > 0) {
      const wasRunning = currentStatus.value === 'running'

      if (wasRunning) {
        applyProgress.value = 'Stopping VM...'
        await vmApi.stop({ proxmox_node: proxmoxNode.value, vm_id: String(vmId.value) })
        await waitForStatus('stopped')
      }

      applyProgress.value = 'Applying config changes...'
      await Promise.all(restartChanges.value.map(c => applyChange(c)))

      if (wasRunning) {
        applyProgress.value = 'Starting VM...'
        await vmApi.start({ proxmox_node: proxmoxNode.value, vm_id: String(vmId.value) })
        await waitForStatus('running')
      }
    }

    // 3. Sync actualConfig to match desiredConfig
    applyProgress.value = 'Syncing state...'
    const desired = props.node.data.desiredConfig as Record<string, unknown>
    if (desired) {
      const newActual: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(desired)) {
        newActual[key] = Array.isArray(value) ? [...value] : value
      }
      props.node.data.actualConfig = newActual
    }

    emit('applied')
  } catch (err) {
    applyError.value = err instanceof Error ? err.message : 'Failed to apply changes'
  } finally {
    isApplying.value = false
    applyProgress.value = ''
  }
}
</script>

<template>
  <div class="modal modal-open">
    <div class="modal-box max-w-md">
      <h3 class="font-bold text-lg mb-4">
        Apply Changes &mdash; {{ (node.data.desiredConfig as Record<string, unknown>)?.name || node.data.label }}
      </h3>

      <!-- Live changes -->
      <div v-if="liveChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-success uppercase tracking-wider mb-1">
          Immediate (no downtime)
        </div>
        <div v-for="c in liveChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">
          <span class="text-success">&#x2713;</span>
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

      <!-- Warning -->
      <div v-if="needsRestart" class="alert alert-warning text-sm mb-4">
        <span>The VM will be stopped and restarted to apply restart-required changes.</span>
      </div>

      <!-- Error -->
      <div v-if="applyError" class="alert alert-error text-sm mb-4">
        <span>{{ applyError }}</span>
      </div>

      <!-- Progress -->
      <div v-if="isApplying" class="flex items-center gap-2 mb-4">
        <span class="loading loading-spinner loading-sm"></span>
        <span class="text-sm">{{ applyProgress }}</span>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <button class="btn btn-ghost" :disabled="isApplying" @click="emit('close')">Cancel</button>
        <button
          class="btn btn-warning"
          :disabled="isApplying"
          @click="handleApply"
        >
          {{ isApplying ? 'Applying...' : 'Apply Changes' }}
        </button>
      </div>
    </div>
    <div class="modal-backdrop" @click="!isApplying && emit('close')"></div>
  </div>
</template>

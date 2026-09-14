<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { vm as vmApi, captureBackendGuard, getTaskStatus } from '@/services/proxmox/api'
import { observedConfig } from '@/services/proxmox/observedConfig'
import { CONFIG_FIELDS, validateConfigChanges, validateConfigReview, validateConfigResult, type ConfigValues, type VmConfigReview } from '@/services/proxmox/configReview'
import type { PendingChange } from '@/services/proxmox/types'

const props = defineProps<{
  node: { data: Record<string, unknown>; id: string; type?: string }
  pendingChanges: PendingChange[]
}>()
const emit = defineEmits<{ close: []; applied: [] }>()
const isRefreshing = ref(false)
const refreshError = ref('')
const refreshStatus = ref('')
const isReviewing = ref(false)
const isApplying = ref(false)
const box = ref<HTMLElement | null>(null)
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
const reviewed = ref<{ value: VmConfigReview; changes: Partial<ConfigValues>; assertCurrent: () => void } | null>(null)
const busy = computed(() => isRefreshing.value || isReviewing.value || isApplying.value)
const canApply = computed(() => {
  if (!reviewed.value || busy.value || !Object.keys(reviewed.value.changes).length) return false
  try { reviewed.value.assertCurrent(); return true } catch { return false }
})
let mounted = true
let closed = false
onMounted(async () => { await nextTick(); if (!closed) box.value?.focus() })
onBeforeUnmount(() => { mounted = false; if (previousFocus?.isConnected) previousFocus.focus() })
const liveChanges = computed(() => props.pendingChanges.filter(c => c.category === 'live'))
const restartChanges = computed(() => props.pendingChanges.filter(c => c.category === 'restart'))
const redeployChanges = computed(() => props.pendingChanges.filter(c => c.category === 'redeploy'))

function target() {
  const config = props.node.data.config as Record<string, unknown> | undefined
  return { id: props.node.id, vmId: Number(props.node.data.vmId), node: config?.proxmoxNode, hostId: config?.proxmoxHostId,
    vmtype: props.node.type === 'lxc' || props.node.data.type === 'lxc' ? 'lxc' as const : 'qemu' as const }
}

function close() { closed = true; emit('close') }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const controls = [...(box.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') || [])]
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === box.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function targetOptions(selected: ReturnType<typeof target>) {
  if (!Number.isSafeInteger(selected.vmId) || selected.vmId < 1 || typeof selected.node !== 'string' || !selected.node) throw new Error('Select a guest and node.')
  if (selected.hostId !== undefined && (typeof selected.hostId !== 'string' || !selected.hostId)) throw new Error('Select a registered host.')
  return { node: selected.node, ...(typeof selected.hostId === 'string' ? { hostId: selected.hostId } : {}) }
}
function identity() { return JSON.stringify([target(), props.node.data.desiredConfig, props.pendingChanges.map(change => [change.field, change.desired])]) }
function guard() {
  const selected = props.node, snapshot = identity(), backend = captureBackendGuard()
  return () => {
    backend()
    if (!mounted || closed || props.node !== selected || identity() !== snapshot) throw new Error('Configuration review changed.')
  }
}
function sameValue(field: string, left: unknown, right: unknown) {
  if (field === 'tags' && typeof left === 'string' && typeof right === 'string') return JSON.stringify(left.split(';').filter(Boolean).sort()) === JSON.stringify(right.split(';').filter(Boolean).sort())
  return left === right
}
function observed(review: VmConfigReview) {
  const raw = { ...review.current, ...(review.vmtype === 'lxc' ? { hostname: review.current.name } : {}) }
  // Partial observations remain visible in review, but never replace a complete local snapshot.
  try { return observedConfig(raw, review.vmtype) } catch { return null }
}

async function reviewChanges() {
  if (busy.value || closed) return
  reviewed.value = null; refreshError.value = ''; refreshStatus.value = ''; isReviewing.value = true
  try {
    const assertCurrent = guard(), selected = target()
    const options = targetOptions(selected)
    const value = await vmApi.getConfigReview(selected.vmId, selected.vmtype, options)
    assertCurrent()
    const changes: Partial<ConfigValues> = {}
    const desired = props.node.data.desiredConfig as Record<string, unknown>
    for (const change of props.pendingChanges) {
      if (!CONFIG_FIELDS.includes(change.field as typeof CONFIG_FIELDS[number])) throw new Error('Unsupported configuration field.')
      const field = change.field as typeof CONFIG_FIELDS[number]
      const next = field === 'tags' && Array.isArray(desired[field]) ? (desired[field] as unknown[]).join(';') : desired[field]
      if (!sameValue(field, next, value.configured[field])) Object.assign(changes, { [field]: next })
    }
    if (Object.keys(changes).length) validateConfigChanges(changes)
    reviewed.value = { value, changes, assertCurrent }
    if (!Object.keys(changes).length) refreshStatus.value = 'Desired values are already configured. Review any pending Proxmox changes below.'
  } catch {
    if (mounted && !closed) refreshError.value = 'Could not review these changes. Check the selected host, guest permissions and configuration values.'
  } finally { if (mounted) isReviewing.value = false }
}

async function applyChanges() {
  if (!canApply.value || !reviewed.value) return
  const request = reviewed.value
  isApplying.value = true; refreshError.value = ''; refreshStatus.value = ''
  try {
    request.assertCurrent()
    const result = validateConfigResult(await vmApi.updateConfig(request.value, request.changes, request.assertCurrent), request.value)
    request.assertCurrent()
    let after = result.review
    if (result.status === 'unconfirmed') throw new Error('Unconfirmed configuration write.')
    if (result.status === 'accepted') {
      refreshStatus.value = 'Proxmox accepted the change. Waiting for its task and configuration readback…'
      const target = { node: request.value.node, hostId: request.value.host_id }
      let complete = false
      for (let count = 0; count < 40; count++) {
        request.assertCurrent()
        const task = await getTaskStatus(result.upid!, target, request.value.target_digest)
        request.assertCurrent()
        if (task.status === 'stopped') {
          if (task.exitstatus !== 'OK') throw new Error('Configuration task failed.')
          complete = true; break
        }
        if (task.status !== 'running') throw new Error('Unknown task state.')
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      if (!complete) throw new Error('Configuration task completion is unconfirmed.')
      after = validateConfigReview(await vmApi.getConfigReview(request.value.vmid, request.value.vmtype, target), request.value)
      request.assertCurrent()
    }
    if (!after || Object.entries(request.changes).some(([field, value]) => !sameValue(field, value, after.configured[field as keyof ConfigValues]))) throw new Error('Configuration readback differs.')
    const actual = observed(after)
    if (actual) props.node.data.actualConfig = actual // eslint-disable-line vue/no-mutating-props -- VueFlow nodes are reactive
    refreshStatus.value = after.pending.length ? 'Configuration verified in Proxmox. Some changes remain pending; running guest resources are not confirmed.' : 'Configuration verified in Proxmox. Desired edits are preserved.'
    reviewed.value = { value: after, changes: {}, assertCurrent: guard() }
  } catch {
    reviewed.value = null
    if (mounted && !closed) { refreshStatus.value = ''; refreshError.value = 'Configuration completion is unconfirmed. Review the original guest before retrying; your desired edits are preserved.' }
  } finally { if (mounted) isApplying.value = false }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || '(none)'
  if (value === undefined || value === null) return '(none)'
  return String(value)
}

async function refreshActual() {
  if (busy.value || closed) return
  reviewed.value = null
  isRefreshing.value = true
  refreshError.value = ''
  refreshStatus.value = ''
  const selectedNode = props.node
  const selected = target()
  try {
    const options = targetOptions(selected)
    const checkBackend = captureBackendGuard()
    const value = await vmApi.getConfigReview(selected.vmId, selected.vmtype, options)
    checkBackend()
    if (!mounted || closed || props.node !== selectedNode || JSON.stringify(target()) !== JSON.stringify(selected)) return
    const actual = observed(value)
    if (!actual) throw new Error('Current configuration is incomplete.')
    props.node.data.actualConfig = actual // eslint-disable-line vue/no-mutating-props -- VueFlow nodes are reactive
    refreshStatus.value = 'Actual configuration refreshed from current Proxmox values. Desired edits are preserved.'
      + (value.pending.length ? ` Pending in Proxmox: ${value.pending.join(', ')}.` : '')
  } catch {
    if (mounted && props.node === selectedNode) refreshError.value = 'Could not refresh the selected guest. Check the backend, target and connection; your edits are unchanged.'
  } finally {
    if (mounted) isRefreshing.value = false
  }
}
</script>

<template>
  <div class="modal modal-open z-[1100] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="apply-changes-title" @keydown="keydown">
    <div ref="box" tabindex="-1" class="modal-box relative z-10 bg-base-100 w-full max-w-xl max-h-[92vh] overflow-y-auto">
      <h3 id="apply-changes-title" class="font-bold text-lg mb-4">
        Apply Changes &mdash; {{ (node.data.desiredConfig as Record<string, unknown>)?.name || node.data.label }}
      </h3>

      <!-- Live changes -->
      <div v-if="liveChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-base-content uppercase tracking-wider mb-1">
          Desired changes
        </div>
        <div v-for="c in liveChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">

          <span class="font-medium">{{ c.label }}:</span>
          <span class="text-base-content/70">{{ formatValue(c.actual) }}</span>
          <span>&rarr;</span>
          <span>{{ formatValue(c.desired) }}</span>
        </div>
      </div>

      <!-- Restart changes -->
      <div v-if="restartChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-base-content uppercase tracking-wider mb-1">
          Requires Restart
        </div>
        <div v-for="c in restartChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">
          <span class="text-warning">&#x26A0;</span>
          <span class="font-medium">{{ c.label }}:</span>
          <span class="text-base-content/70">{{ formatValue(c.actual) }}</span>
          <span>&rarr;</span>
          <span>{{ formatValue(c.desired) }}</span>
        </div>
      </div>

      <!-- Redeploy changes -->
      <div v-if="redeployChanges.length > 0" class="mb-3">
        <div class="text-xs font-semibold text-base-content uppercase tracking-wider mb-1">
          Requires Redeployment
        </div>
        <div v-for="c in redeployChanges" :key="c.field" class="flex items-center gap-2 text-sm py-1">
          <span class="text-error">&#x26D4;</span>
          <span class="font-medium">{{ c.label }}:</span>
          <span class="text-base-content/70">{{ formatValue(c.actual) }}</span>
          <span>&rarr;</span>
          <span>{{ formatValue(c.desired) }}</span>
        </div>
      </div>

      <div class="alert alert-warning text-sm mb-4" role="note">
        <span>Review fresh configuration from the selected host before applying. Current and pending Proxmox values are separate; this action does not restart the guest.</span>
      </div>
      <section v-if="reviewed" class="rounded-lg border border-base-300 p-3 mb-4 text-sm space-y-3" data-testid="config-write-review">
        <p class="font-medium break-all">{{ reviewed.value.node }} · {{ reviewed.value.vmtype }} {{ reviewed.value.vmid }}</p>
        <div class="overflow-x-auto" tabindex="0" role="region" aria-label="Configuration comparison">
          <table class="table table-xs w-full">
            <caption class="text-left mb-2">Configuration read from Proxmox</caption>
            <thead><tr><th>Field</th><th>Current</th><th>Configured</th><th>To apply</th></tr></thead>
            <tbody><tr v-for="field in CONFIG_FIELDS" :key="field"><th>{{ field }}</th><td class="max-w-40 break-words whitespace-pre-wrap">{{ formatValue(reviewed.value.current[field]) }}</td><td class="max-w-40 break-words whitespace-pre-wrap">{{ formatValue(reviewed.value.configured[field]) }}</td><td class="max-w-40 break-words whitespace-pre-wrap">{{ Object.hasOwn(reviewed.changes, field) ? formatValue(reviewed.changes[field]) : '—' }}</td></tr></tbody>
          </table>
        </div>
        <p v-if="reviewed.value.pending.length">Pending in Proxmox: {{ reviewed.value.pending.join(', ') }}. Review the guest's restart requirements separately.</p>
        <p v-if="!canApply && Object.keys(reviewed.changes).length && !busy" role="status">The review changed. Review the current settings again before applying.</p>
      </section>
      <div v-if="refreshError" class="alert alert-error text-sm mb-4" role="alert">{{ refreshError }}</div>
      <p v-if="refreshStatus" class="text-sm mb-4" role="status">{{ refreshStatus }}</p>
      <div class="modal-action flex-wrap">
        <button class="btn btn-ghost" @click="close">Close</button>
        <button class="btn btn-outline" :disabled="busy" @click="refreshActual">
          {{ isRefreshing ? 'Refreshing…' : 'Refresh actual configuration' }}
        </button>
        <button class="btn btn-outline" :disabled="busy" @click="reviewChanges">{{ isReviewing ? 'Reviewing…' : 'Review changes' }}</button>
        <button class="btn btn-warning" :disabled="!canApply" @click="applyChanges">{{ isApplying ? 'Applying…' : 'Apply Changes' }}</button>
      </div>
    </div>
    <div class="modal-backdrop z-0" @click="close"></div>
  </div>
</template>

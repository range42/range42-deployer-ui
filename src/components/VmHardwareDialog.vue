<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vm, captureBackendGuard, getTaskStatus } from '@/services/proxmox/api'
import { validateDiskGrowth, validateHardwareResult, validateHardwareReview, validateNicChanges, type HardwareReview, type NicChanges } from '@/services/proxmox/hardwareReview'

const props = defineProps<{ target: { hostId: string; node: string; vmid: number } }>()
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement | null>(null)
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
const observation = ref<HardwareReview | null>(null), busy = ref(false), error = ref(''), status = ref('')
const kind = ref<'nic' | 'disk'>('nic'), selected = ref('')
const draft = ref({ bridge: '', tag: '' as number | string, firewall: false, link_down: false, size: 0 })
type Review = { value: HardwareReview; key: string; kind: 'nic' | 'disk'; changes: NicChanges; size: number; assertCurrent: () => void }
const reviewed = ref<Review | null>(null)
let mounted = true, epoch = 0
const options = computed(() => kind.value === 'nic' ? observation.value?.configured.nics || [] : observation.value?.configured.disks || [])
const selectedRow = computed(() => options.value.find(row => row.id === selected.value))
const unavailable = computed(() => !selectedRow.value?.editable || observation.value?.pending.includes(selected.value))
const targetOptions = () => ({ hostId: props.target.hostId, node: props.target.node })
const identity = () => JSON.stringify([props.target, kind.value, selected.value, draft.value])
function guard(includeDraft: boolean) {
  const backend = captureBackendGuard(), stamp = epoch, target = JSON.stringify(props.target), form = identity()
  return () => {
    backend()
    if (!mounted || stamp !== epoch || JSON.stringify(props.target) !== target || includeDraft && identity() !== form) throw new Error('The hardware review changed. Refresh and review again.')
  }
}
function choose() {
  reviewed.value = null
  const nic = observation.value?.configured.nics.find(row => row.id === selected.value)
  const disk = observation.value?.configured.disks.find(row => row.id === selected.value)
  draft.value = { bridge: nic?.bridge || '', tag: nic?.tag ?? '', firewall: nic?.firewall ?? false, link_down: nic?.link_down ?? false,
    size: disk?.size_bytes ? Math.ceil(disk.size_bytes / 1024 ** 3) : 0 }
}
watch([kind, selected], choose)
watch(kind, () => { selected.value = options.value[0]?.id || ''; choose() })
watch(() => JSON.stringify(props.target), () => { epoch++; observation.value = null; reviewed.value = null; error.value = 'The selected guest changed. Refresh its hardware.'; status.value = ''; busy.value = false })
function close() { epoch++; emit('close') }
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const controls = [...(box.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') || [])]
  if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === box.value)) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
async function refresh() {
  if (busy.value) return
  busy.value = true; reviewed.value = null; error.value = ''; status.value = ''
  const stamp = epoch
  try {
    const current = guard(false)
    const value = await vm.getHardwareReview(props.target.vmid, targetOptions())
    current(); observation.value = value
    selected.value = options.value.some(row => row.id === selected.value) ? selected.value : options.value[0]?.id || ''
    choose()
  } catch { if (mounted && stamp === epoch) error.value = 'Could not read this imported guest. Check its registered host, permissions and ownership.' }
  finally { if (mounted && stamp === epoch) busy.value = false }
}
function changes(): NicChanges {
  const original = observation.value?.configured.nics.find(row => row.id === selected.value)
  if (!original) throw new Error('Select an existing NIC.')
  const desired = { bridge: draft.value.bridge, tag: draft.value.tag === '' ? null : Number(draft.value.tag), firewall: draft.value.firewall, link_down: draft.value.link_down }
  return validateNicChanges(Object.fromEntries(Object.entries(desired).filter(([key, value]) => original[key as keyof typeof desired] !== value)))
}
async function review() {
  if (!observation.value || busy.value || unavailable.value) return
  reviewed.value = null; error.value = ''; status.value = ''; busy.value = true
  const stamp = epoch
  try {
    const current = guard(true), expected = observation.value
    const patch = kind.value === 'nic' ? changes() : {}
    if (kind.value === 'disk') {
      validateDiskGrowth(selected.value, draft.value.size)
      const disk = expected.configured.disks.find(row => row.id === selected.value)
      if (!disk?.size_bytes || draft.value.size * 1024 ** 3 <= disk.size_bytes) throw new Error('Choose a size larger than the existing disk.')
    }
    const fresh = validateHardwareReview(await vm.getHardwareReview(props.target.vmid, targetOptions()), expected)
    current()
    if (fresh.digest !== expected.digest) throw new Error('Proxmox configuration changed. Refresh before reviewing this edit.')
    if (fresh.pending.includes(selected.value)) throw new Error('The selected device has pending changes.')
    reviewed.value = { value: fresh, key: selected.value, kind: kind.value, changes: patch, size: draft.value.size, assertCurrent: current }
  } catch (cause) { if (mounted && stamp === epoch) error.value = cause instanceof Error ? cause.message : 'Hardware review failed.' }
  finally { if (mounted && stamp === epoch) busy.value = false }
}
const canApply = computed(() => {
  if (!reviewed.value || busy.value) return false
  try { reviewed.value.assertCurrent(); return true } catch { return false }
})
async function apply() {
  if (!reviewed.value || busy.value) return
  const request = reviewed.value, stamp = epoch
  reviewed.value = null; busy.value = true; error.value = ''; status.value = ''
  try {
    request.assertCurrent()
    const result = validateHardwareResult(request.kind === 'nic'
      ? await vm.updateHardwareNic(request.value, request.key, request.changes, request.assertCurrent)
      : await vm.growHardwareDisk(request.value, request.key, request.size, request.assertCurrent), request.value)
    request.assertCurrent()
    if (result.status === 'unconfirmed') throw new Error('Hardware completion is unconfirmed.')
    let after = result.review
    if (result.status === 'accepted') {
      status.value = 'Proxmox accepted the edit. Waiting for its task and hardware readback…'
      let complete = false
      for (let count = 0; count < 40; count++) {
        request.assertCurrent()
        const task = await getTaskStatus(result.upid!, { hostId: request.value.host_id, node: request.value.node }, request.value.target_digest)
        request.assertCurrent()
        if (task.status === 'stopped') { if (task.exitstatus !== 'OK') throw new Error('Hardware task failed.'); complete = true; break }
        if (task.status !== 'running') throw new Error('Unknown hardware task state.')
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      if (!complete) throw new Error('Hardware task completion is unconfirmed.')
      after = validateHardwareReview(await vm.getHardwareReview(request.value.vmid, { hostId: request.value.host_id, node: request.value.node }), request.value)
      request.assertCurrent()
    }
    if (!after) throw new Error('Hardware readback is unavailable.')
    if (request.kind === 'nic') {
      const original = request.value.configured.nics.find(row => row.id === request.key)!, actual = after.configured.nics.find(row => row.id === request.key)
      if (!actual || actual.mac !== original.mac || actual.model !== original.model || Object.entries(request.changes).some(([key, value]) => actual[key as keyof NicChanges] !== value)) throw new Error('NIC readback differs.')
    } else {
      const original = request.value.configured.disks.find(row => row.id === request.key)!, actual = after.configured.disks.find(row => row.id === request.key)
      if (!actual || actual.volume_fingerprint !== original.volume_fingerprint || actual.size_bytes !== request.size * 1024 ** 3) throw new Error('Disk readback differs.')
    }
    observation.value = after; choose()
    status.value = after.pending.includes(request.key) ? 'Configuration verified. This device still has pending Proxmox changes; it is not confirmed active in the running guest.'
      : request.kind === 'disk' ? 'Disk size verified in Proxmox. Growing the guest partition or filesystem is a separate operation.' : 'NIC configuration verified in Proxmox. Guest connectivity has not been tested.'
  } catch { if (mounted && stamp === epoch) { status.value = ''; error.value = 'Hardware completion is unconfirmed. Review the original guest before retrying. Your typed values are preserved.' } }
  finally { if (mounted && stamp === epoch) busy.value = false }
}
onMounted(async () => { await nextTick(); if (mounted) { box.value?.focus(); void refresh() } })
onBeforeUnmount(() => { mounted = false; epoch++; if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center p-3" @keydown="keyboard">
      <section ref="box" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="hardware-title" :aria-busy="busy" class="bg-base-100 rounded-box p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto min-w-0 space-y-4">
        <h2 id="hardware-title" class="text-lg font-semibold">Existing guest hardware</h2>
        <p class="text-sm break-all">{{ target.node }} · QEMU {{ target.vmid }} · {{ target.hostId }}</p>
        <p class="text-sm">Review one existing NIC or grow one existing data disk. Network changes can interrupt connectivity. This does not create devices, move disks, change guest IP configuration or rewrite the authored scenario topology.</p>
        <fieldset :disabled="busy || !observation" class="space-y-3">
          <label class="form-control gap-1">Device type<select v-model="kind" class="select select-bordered w-full" data-testid="hardware-kind"><option value="nic">Network interface</option><option value="disk">Data disk growth</option></select></label>
          <label class="form-control gap-1">Existing device<select v-model="selected" class="select select-bordered w-full"><option v-for="row in options" :key="row.id" :value="row.id">{{ row.id }}{{ !row.editable ? ' — unavailable' : '' }}</option></select></label>
          <p v-if="!options.length" class="text-sm">No supported device observations.</p>
          <template v-if="kind === 'nic' && selectedRow">
            <label class="form-control gap-1">Bridge<input v-model="draft.bridge" maxlength="15" class="input input-bordered w-full" data-testid="hardware-bridge" /></label>
            <label class="form-control gap-1">VLAN tag (blank removes tag)<input v-model="draft.tag" type="number" min="1" max="4094" class="input input-bordered w-full" /></label>
            <label class="flex gap-2 items-center"><input v-model="draft.firewall" type="checkbox" class="checkbox checkbox-sm" /> Enable Proxmox NIC firewall</label>
            <label class="flex gap-2 items-center"><input v-model="draft.link_down" type="checkbox" class="checkbox checkbox-sm" /> Disconnect link</label>
            <p class="text-sm">Model, MAC and other NIC options remain as read from Proxmox.</p>
          </template>
          <template v-else-if="kind === 'disk' && selectedRow">
            <label class="form-control gap-1">New absolute disk size (GiB)<input v-model.number="draft.size" type="number" min="1" max="65536" class="input input-bordered w-full" data-testid="hardware-size" /></label>
            <p class="text-sm">Growth cannot be reversed here. The guest partition and filesystem are separate from the virtual disk.</p>
          </template>
          <p v-if="unavailable && selected" class="text-sm">This device is unreadable, unsupported or has pending Proxmox changes. Settle its configuration before editing.</p>
        </fieldset>
        <section v-if="reviewed" class="border border-base-300 rounded-lg p-3 space-y-2 text-sm" data-testid="hardware-comparison">
          <h3 class="font-medium">Review {{ reviewed.key }}</h3>
          <template v-if="reviewed.kind === 'nic'"><p v-for="(value, key) in reviewed.changes" :key="key">{{ key }}: {{ reviewed.value.configured.nics.find(row => row.id === reviewed!.key)?.[key] ?? '(none)' }} → {{ value ?? '(none)' }}</p></template>
          <p v-else>Disk: {{ (reviewed.value.configured.disks.find(row => row.id === reviewed!.key)?.size_bytes || 0) / 1024 ** 3 }} GiB → {{ reviewed.size }} GiB</p>
          <p>Confirm sends one conditional request to this guest. No restart is requested.</p>
        </section>
        <p v-if="error" role="alert" class="text-error text-sm break-words">{{ error }}</p>
        <p v-if="status" role="status" class="text-sm">{{ status }}</p>
        <p v-if="observation?.pending.length" class="text-sm">Pending in Proxmox: {{ observation.pending.join(', ') }}.</p>
        <div class="flex flex-wrap gap-2 justify-end">
          <button class="btn btn-ghost" @click="close">Close</button>
          <button class="btn btn-outline" :disabled="busy" @click="refresh">Refresh hardware</button>
          <button class="btn btn-outline" :disabled="busy || !observation || unavailable" data-testid="hardware-review" @click="review">Review change</button>
          <button class="btn btn-primary" :disabled="!canApply" data-testid="hardware-apply" @click="apply">Confirm and apply</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

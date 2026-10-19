<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { backendBlob, backendRequest } from '@/services/backendApi'
defineOptions({ name: 'WorkshopManagement' })

interface Device { id: number; address: string; name: string; online: boolean; bound?: boolean }
interface Seat {
  username: string; proxmox_address: string; deployer_address: string; account_ready: boolean;
  key_ready: boolean; handout_ready: boolean; closed?: boolean; device?: Device | null; devices: Device[];
  deployment_id?: string | null; deployment_state: string; certificate_fingerprint?: string | null;
}
interface Operation { operation_id: string; action: string; username?: string; state: string; message?: string }
interface Workshop { id: string; expires_at: string; seats: Seat[]; operations: Operation[] }
interface Action { action: string; username?: string; node_id?: number; seats?: number; confirmation?: string }
const workshop = ref<Workshop | null>(null)
const error = ref('')
const message = ref('')
const loading = ref(false)
const submitting = ref(false)
const seats = ref(10)
function labelFor(action: string) {
  return ({ prepare: 'Prepare workshop', accounts: 'Create accounts', keys: 'Issue VPN keys', handouts: 'Generate PDFs',
    bind: 'Enable laptop access', revoke: 'Revoke laptop access', close: 'Close participant access',
    deploy: 'Deploy instance', configure: 'Configure instance', reset: 'Reset instance', teardown: 'Delete instance',
    replace_key: 'Replace VPN key' } as Record<string, string>)[action] || action
}
const confirmation = ref('')
const pending = ref<Action | null>(null)
const confirmInput = ref<HTMLInputElement | null>(null)
const busy = computed(() => submitting.value || loading.value || !!error.value ||
  workshop.value?.operations.some(op => ['queued', 'running'].includes(op.state)))
let timer: ReturnType<typeof setInterval> | undefined
let stopped = false

async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await backendRequest<Workshop>('/v1/admin/workshop')
    if (!stopped) { workshop.value = result; error.value = '' }
  } catch (e) { if (!stopped) error.value = e instanceof Error ? e.message : 'Could not load workshop status.' }
  finally { loading.value = false }
}
async function submit(action: Action) {
  submitting.value = true; message.value = ''; error.value = ''
  try {
    const operation = await backendRequest<Operation>('/v1/admin/workshop/actions', { method: 'POST', body: JSON.stringify(action) })
    message.value = `${labelFor(action.action)} queued${action.username ? ` for ${action.username}` : ''}. Operation ${operation.operation_id}.`
    pending.value = null
    await refresh()
  } catch (e) { error.value = e instanceof Error ? e.message : 'The workshop action failed.' }
  finally { submitting.value = false }
}
async function destructive(action: string, username: string) {
  pending.value = { action, username }; confirmation.value = ''
  await nextTick(); confirmInput.value?.focus()
}
async function download(username: string) {
  submitting.value = true
  try {
    const blob = await backendBlob(`/v1/admin/workshop/seats/${username}/handout`)
    const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `${username}.pdf`; link.click(); URL.revokeObjectURL(url)
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not download the private handout.' }
  finally { submitting.value = false }
}
onMounted(() => { void refresh(); timer = setInterval(() => { if (!pending.value) void refresh() }, 5000) })
onUnmounted(() => { stopped = true; if (timer) clearInterval(timer) })
</script>

<template>
  <section class="max-w-7xl mx-auto p-6 space-y-6">
    <header class="flex flex-wrap gap-4 items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Workshop</h1>
        <p class="text-sm text-base-content/70 mt-1">Prepare participant accounts, enable each laptop and manage its isolated environment.</p>
        <p v-if="workshop" class="text-sm mt-2">{{ workshop.id }} · Access expires {{ workshop.expires_at }} (UTC)</p>
      </div>
      <button class="btn btn-sm" :disabled="loading" @click="refresh">Refresh status</button>
    </header>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="message" role="status" class="alert alert-info">{{ message }}</p>
    <p v-if="loading && !workshop" role="status">Loading workshop…</p>
    <template v-if="workshop">
      <div class="card bg-base-100 border border-base-300 p-4 space-y-3">
        <h2 class="font-semibold">Participant preparation</h2>
        <p class="text-sm text-base-content/70">Prepare once, then create accounts, issue connection keys and generate private PDFs. Repeating a step preserves existing credentials.</p>
        <div class="flex flex-wrap items-center gap-2">
          <label v-if="!workshop.seats.length" class="flex items-center gap-2">Seats
            <select v-model.number="seats" class="select select-sm" :disabled="busy"><option :value="5">5</option><option :value="10">10</option></select>
          </label>
          <button v-if="!workshop.seats.length" class="btn btn-sm btn-primary" :disabled="busy" @click="submit({ action: 'prepare', seats })">Prepare workshop</button>
          <button class="btn btn-sm" :disabled="busy || !workshop.seats.length" @click="submit({ action: 'accounts' })">Create accounts</button>
          <button class="btn btn-sm" :disabled="busy || !workshop.seats.length || workshop.seats.some(seat => !seat.account_ready)" @click="submit({ action: 'keys' })">Issue VPN keys</button>
          <button class="btn btn-sm" :disabled="busy || !workshop.seats.length || workshop.seats.some(seat => !seat.key_ready)" @click="submit({ action: 'handouts' })">Generate credential PDFs</button>
        </div>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <article v-for="seat in workshop.seats" :key="seat.username" class="card bg-base-100 border border-base-300 p-5 space-y-4">
          <header class="flex justify-between items-center gap-2">
            <h2 class="text-lg font-semibold">{{ seat.username }}</h2>
            <span class="badge" :class="seat.closed ? 'badge-ghost' : seat.device?.online ? 'badge-success' : 'badge-warning'">{{ seat.closed ? 'Closed' : seat.device?.online ? 'Laptop connected' : 'Awaiting laptop' }}</span>
          </header>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt>Account</dt><dd>{{ seat.account_ready ? 'Ready' : 'Not prepared' }}</dd>
            <dt>VPN key</dt><dd>{{ seat.key_ready ? 'Issued' : 'Not issued' }}</dd>
            <dt>Environment</dt><dd>{{ seat.deployment_state }}</dd>
            <dt>Proxmox</dt><dd><a class="link" :href="`https://${seat.proxmox_address}:8006`" target="_blank" rel="noopener noreferrer">{{ seat.proxmox_address }}</a></dd>
            <dt>Deployer SSH</dt><dd><code>range42@{{ seat.deployer_address }}</code></dd>
          </dl>
          <p v-if="seat.certificate_fingerprint" class="text-xs break-all">Verified certificate: {{ seat.certificate_fingerprint }}</p>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm" :disabled="busy || !seat.handout_ready" @click="download(seat.username)">Download credentials</button>
            <button class="btn btn-sm" :data-testid="`replace-key-${seat.username}`" :disabled="busy || !seat.key_ready || seat.closed || !!seat.device" @click="destructive('replace_key', seat.username)">Replace VPN key</button>
            <RouterLink v-if="seat.deployment_id" class="btn btn-sm" :to="`/deployments/${seat.deployment_id}`">Deployment and logs</RouterLink>
            <button class="btn btn-sm btn-primary" :disabled="busy || seat.closed || !seat.account_ready || !!seat.deployment_id" @click="submit({ action: 'deploy', username: seat.username })">Deploy instance</button>
            <button class="btn btn-sm" :disabled="busy || !seat.deployment_id || seat.closed" @click="submit({ action: 'configure', username: seat.username })">Check / configure</button>
            <button class="btn btn-sm" :data-testid="`reset-${seat.username}`" :disabled="busy || !seat.deployment_id" @click="destructive('reset', seat.username)">Reset instance</button>
            <button class="btn btn-sm btn-error btn-outline" :disabled="busy || !seat.deployment_id" @click="destructive('teardown', seat.username)">Delete instance</button>
          </div>
          <section class="border-t border-base-300 pt-3 space-y-2">
            <h3 class="font-medium text-sm">Laptop enrollment</h3>
            <p class="text-xs text-base-content/70">Verify the participant's username and laptop before enabling access. Only the selected laptop can reach this seat.</p>
            <p v-if="seat.device" class="text-sm">Bound laptop: {{ seat.device.name || seat.device.id }} · {{ seat.device.address }}</p>
            <p v-if="!seat.devices.length" class="text-sm text-base-content/60">No enrolled device observed. Have the participant connect with their PDF's one-use key, then refresh.</p>
            <div v-for="device in seat.devices" :key="device.id" class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{{ device.name || `Device ${device.id}` }} · {{ device.address }} · {{ device.online ? 'online' : 'offline' }}</span>
              <button class="btn btn-xs" :data-testid="`bind-${seat.username}-${device.id}`" :disabled="busy || !device.online || device.bound || !!seat.device || seat.closed" @click="submit({ action: 'bind', username: seat.username, node_id: device.id })">{{ device.bound ? 'Access enabled' : 'Enable laptop access' }}</button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button v-if="seat.device" class="btn btn-xs" :disabled="busy" @click="submit({ action: 'revoke', username: seat.username })">Revoke laptop access</button>
              <button class="btn btn-xs btn-ghost" :disabled="busy || seat.closed" @click="destructive('close', seat.username)">Close participant access</button>
            </div>
          </section>
        </article>
      </div>
      <section v-if="workshop.operations.length" class="space-y-2">
        <h2 class="text-lg font-semibold">Recent operations</h2>
        <ul class="space-y-2"><li v-for="op in workshop.operations" :key="op.operation_id" class="border border-base-300 rounded-lg p-3 text-sm">
          <strong>{{ labelFor(op.action) }} {{ op.username || '' }}</strong> · {{ op.state }}<p v-if="op.message">{{ op.message }}</p>
        </li></ul>
      </section>
    </template>
    <div v-if="pending" role="dialog" aria-modal="true" aria-labelledby="workshop-confirm-title" class="modal modal-open" @keydown.esc="pending = null">
      <form class="modal-box space-y-4" @submit.prevent="submit({ ...pending!, confirmation })">
        <h2 id="workshop-confirm-title" class="font-semibold text-lg">Confirm: {{ labelFor(pending.action) }} for {{ pending.username }}</h2>
        <p>{{ pending.action === 'close' ? 'This disables the participant account and VPN access.' : pending.action === 'replace_key' ? 'This invalidates previous VPN access and generates a new one-use key. Download the updated credential PDF after it finishes.' : 'This removes the participant’s current installation and lab data from this instance.' }} Other seats remain available.</p>
        <label class="form-control">Type {{ pending.username }} to continue
          <input ref="confirmInput" v-model="confirmation" data-testid="seat-confirmation" class="input input-bordered mt-2" autocomplete="off" />
        </label>
        <div class="modal-action">
          <button type="button" class="btn" @click="pending = null">Cancel</button>
          <button type="submit" data-testid="confirm-destructive" class="btn btn-error" :disabled="confirmation !== pending.username || submitting">{{ labelFor(pending.action) }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

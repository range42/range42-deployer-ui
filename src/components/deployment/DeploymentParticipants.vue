<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { backendBlob, backendRequest } from '@/services/backendApi'
defineOptions({ name: 'DeploymentParticipants' })
const props = defineProps<{ deploymentId: string; eligibleCohort?: boolean; disabled?: boolean }>()

interface Device { id: number; address: string; name: string; online: boolean; bound?: boolean }
interface Seat {
  username: string; proxmox_address: string; deployer_address: string; account_ready: boolean;
  key_ready: boolean; handout_ready: boolean; closed?: boolean; device?: Device | null; devices: Device[];
  deployment_id?: string | null; deployment_state: string; certificate_fingerprint?: string | null;
}
interface Operation { operation_id: string; action: string; username?: string; state: string; message?: string }
interface Workshop { cohort_seats?: number | null; cohort_deployment_id?: string | null; id: string; expires_at: string; seats: Seat[]; operations: Operation[] }
interface Action { action: string; deployment_id?: string; username?: string; node_id?: number; seats?: number; confirmation?: string }
const workshop = ref<Workshop | null>(null)
const isCohort = computed(() => !!workshop.value?.cohort_deployment_id && workshop.value.cohort_deployment_id === props.deploymentId)
const visibleSeats = computed(() => workshop.value?.seats.filter(seat => (isCohort.value && (!workshop.value?.cohort_seats || Number(seat.username.slice(4)) <= workshop.value.cohort_seats)) || seat.deployment_id === props.deploymentId) || [])
const associated = computed(() => isCohort.value || visibleSeats.value.length > 0)
const error = ref('')
const message = ref('')
const loading = ref(false)
const submitting = ref(false)
const seats = ref(10)
function labelFor(action: string) {
  return ({ prepare: 'Prepare workshop', accounts: 'Create accounts', keys: 'Issue VPN keys', handouts: 'Generate PDFs',
    link: 'Connect participant management', bind: 'Enable laptop access', revoke: 'Revoke laptop access', close: 'Close participant access',
    deploy: 'Deploy instance', configure: 'Configure instance', reset: 'Reset instance', teardown: 'Delete instance',
    replace_key: 'Replace VPN key' } as Record<string, string>)[action] || action
}
const confirmation = ref('')
const pending = ref<Action | null>(null)
const confirmInput = ref<HTMLInputElement | null>(null)
const busy = computed(() => props.disabled || submitting.value || loading.value || !!error.value ||
  workshop.value?.operations.some(op => ['queued', 'running'].includes(op.state)))
function failedAccess(username: string, action: string) {
  return workshop.value?.operations.find(op => op.username === username &&
    (action === 'revoke' ? ['revoke', 'close'].includes(op.action) : op.action === action))?.state === 'failed'
}
function downloadBlocked(seat: Seat) {
  return props.disabled || submitting.value || loading.value || !!error.value || !seat.handout_ready ||
    workshop.value?.operations.some(op => ['queued', 'running'].includes(op.state) &&
      (['prepare', 'accounts', 'keys', 'handouts'].includes(op.action) ||
       (op.username === seat.username && ['deploy', 'configure', 'reset', 'teardown', 'replace_key', 'close'].includes(op.action))))
}
let timer: ReturnType<typeof setInterval> | undefined
let stopped = false

async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await backendRequest<Workshop>('/v1/admin/workshop')
    if (!result || !Array.isArray(result.seats) || !Array.isArray(result.operations)) throw new Error('Participant status is unavailable. Refresh to retry.')
    if (!stopped) { workshop.value = result; if (!result.seats.length && result.cohort_seats) seats.value = result.cohort_seats; error.value = '' }
  } catch (e) { if (!stopped) error.value = e instanceof Error ? e.message : 'Could not load workshop status.' }
  finally { loading.value = false }
}
async function submit(action: Action) {
  if (props.disabled || (action.action === 'link' ? !props.eligibleCohort || action.deployment_id !== props.deploymentId
    : !associated.value || (action.username ? !visibleSeats.value.some(seat => seat.username === action.username) : !isCohort.value))) return
  submitting.value = true; message.value = ''; error.value = ''
  try {
    const operation = await backendRequest<Operation>('/v1/admin/workshop/actions', { method: 'POST', body: JSON.stringify(action) })
    message.value = `${labelFor(action.action)} queued${action.username ? ` for ${action.username}` : ''}. Operation ${operation.operation_id}.`
    pending.value = null
    await refresh()
  } catch (e) { error.value = e instanceof Error ? e.message : 'The workshop action failed.' }
  finally { submitting.value = false }
}
let confirmationOpener: HTMLElement | null = null
function closeConfirmation() {
  pending.value = null
  void nextTick(() => confirmationOpener?.focus())
}
function trapConfirmation(event: KeyboardEvent) {
  const dialog = event.currentTarget as HTMLElement
  const items = [...dialog.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled])')]
  const first = items[0], last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
async function requestLink() {
  confirmationOpener = document.activeElement as HTMLElement
  pending.value = { action: 'link', deployment_id: props.deploymentId }
  await nextTick(); document.getElementById('workshop-confirm-cancel')?.focus()
}
async function destructive(action: string, username: string) {
  confirmationOpener = document.activeElement as HTMLElement
  pending.value = { action, username }; confirmation.value = ''
  await nextTick(); confirmInput.value?.focus()
}
async function download(username: string) {
  if (!visibleSeats.value.some(seat => seat.username === username)) return
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
  <section v-if="associated || eligibleCohort || error || loading" class="my-4 space-y-6" data-testid="deployment-participants">
    <header class="flex flex-wrap gap-4 items-start justify-between">
      <div>
        <h2 class="text-xl font-semibold">Participants and access</h2>
        <p class="text-sm text-base-content/70 mt-1">Prepare participant accounts, enable each laptop and manage its isolated environment.</p>
        <p v-if="workshop" class="text-sm mt-2">{{ workshop.id }} · Access expires {{ workshop.expires_at }} (UTC)</p>
      </div>
      <button class="btn btn-sm" :disabled="loading" @click="refresh">Refresh status</button>
    </header>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="message" role="status" class="alert alert-info">{{ message }}</p>
    <p v-if="loading && !workshop" role="status">Loading workshop…</p>
    <div v-if="workshop && !associated && eligibleCohort" class="rounded border border-base-300 p-4 space-y-3">
      <h3 class="font-medium">Connect participant management</h3>
      <p class="text-sm">Connect the platform’s prepared participant accounts and isolated environments to this whole-cohort deployment. Existing accounts, keys and machines are preserved.</p>
      <p v-if="workshop.cohort_deployment_id" class="text-sm">Currently connected deployment: <RouterLink class="link" :to="`/deployments/${workshop.cohort_deployment_id}`">{{ workshop.cohort_deployment_id }}</RouterLink></p>
      <button type="button" class="btn btn-primary btn-sm" :disabled="busy" data-testid="workshop-link-deployment" @click="requestLink">Connect participant management</button>
    </div>
    <template v-if="workshop && associated">
      <div v-if="isCohort" class="card bg-base-100 border border-base-300 p-4 space-y-3">
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
        <article v-for="seat in visibleSeats" :key="seat.username" class="card bg-base-100 border border-base-300 p-5 space-y-4">
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
            <button class="btn btn-sm" :disabled="downloadBlocked(seat)" @click="download(seat.username)">Download credentials</button>
            <button class="btn btn-sm" :data-testid="`replace-key-${seat.username}`" :disabled="busy || !seat.account_ready || seat.closed || !!seat.device" @click="destructive('replace_key', seat.username)">Replace VPN key</button>
            <RouterLink v-if="seat.deployment_id" class="btn btn-sm" :to="`/deployments/${seat.deployment_id}`">Deployment and logs</RouterLink>
            <button class="btn btn-sm btn-primary" :disabled="busy || seat.closed || !seat.account_ready || (!!seat.deployment_id && !['failed', 'pending'].includes(seat.deployment_state))" @click="submit({ action: 'deploy', username: seat.username })">Deploy instance</button>
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
              <button class="btn btn-xs" :data-testid="`bind-${seat.username}-${device.id}`" :disabled="busy || !device.online || (device.bound && !failedAccess(seat.username, 'bind')) || (!!seat.device && (!failedAccess(seat.username, 'bind') || seat.device.id !== device.id)) || seat.closed" @click="submit({ action: 'bind', username: seat.username, node_id: device.id })">{{ device.bound && !failedAccess(seat.username, 'bind') ? 'Access enabled' : 'Enable laptop access' }}</button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button v-if="seat.device || failedAccess(seat.username, 'revoke')" class="btn btn-xs" :disabled="busy" @click="submit({ action: 'revoke', username: seat.username })">Revoke laptop access</button>
              <button class="btn btn-xs btn-ghost" :disabled="busy || seat.closed" @click="destructive('close', seat.username)">Close participant access</button>
            </div>
          </section>
        </article>
      </div>
      <section v-if="workshop.operations.length" class="space-y-2">
        <h2 class="text-lg font-semibold">Recent operations</h2>
        <ul class="space-y-2"><li v-for="op in workshop.operations" :key="op.operation_id" :data-operation-id="op.operation_id" :data-state="op.state" class="border border-base-300 rounded-lg p-3 text-sm">
          <strong>{{ labelFor(op.action) }} {{ op.username || '' }}</strong> · {{ op.state }}<p v-if="op.message">{{ op.message }}</p>
        </li></ul>
      </section>
    </template>
    <div v-if="pending" role="dialog" aria-modal="true" aria-labelledby="workshop-confirm-title" class="modal modal-open" @keydown.esc.prevent="closeConfirmation" @keydown.tab="trapConfirmation">
      <form class="modal-box space-y-4" @submit.prevent="submit(pending!.action === 'link' ? pending! : { ...pending!, confirmation })">
        <h2 id="workshop-confirm-title" class="font-semibold text-lg">Confirm: {{ labelFor(pending.action) }} for {{ pending.username || deploymentId }}</h2>
        <p v-if="pending.action === 'link'">This moves participant management to this saved deployment. Accounts, credentials, VM allocations and the controller’s execution target are preserved.</p>
        <p v-else>{{ pending.action === 'close' ? 'This disables the participant account and VPN access.' : pending.action === 'replace_key' ? 'This invalidates previous VPN access and generates a new one-use key. Download the updated credential PDF after it finishes.' : 'This removes the participant’s current installation and lab data from this instance.' }} Other seats remain available.</p>
        <label v-if="pending.action !== 'link'" class="form-control">Type {{ pending.username }} to continue
          <input ref="confirmInput" v-model="confirmation" data-testid="seat-confirmation" name="participant-confirmation" spellcheck="false" class="input input-bordered mt-2" autocomplete="off" />
        </label>
        <div class="modal-action">
          <button id="workshop-confirm-cancel" type="button" class="btn" @click="closeConfirmation">Cancel</button>
          <button type="submit" data-testid="confirm-destructive" class="btn btn-error" :disabled="(pending.action !== 'link' && confirmation !== pending.username) || submitting">{{ labelFor(pending.action) }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

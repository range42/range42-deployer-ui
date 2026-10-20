<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { backendBlob, backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useDialogKeyboard } from '@/composables/useDialogKeyboard'

const props = defineProps<{deploymentId: string; disabled?: boolean; participantsPerEnvironment?: number}>()
const emit = defineEmits<{started: [attempt: {id: string; state: string}]}>()
interface Participant {username: string; seat: number; state: string; attempt_id?: string | null; proxmox_address: string; deployer_address: string}
interface Workshop {deployment_id: string; namespace: string; phase: string; ready: boolean; expires_at: string;
  participants: Participant[]; identity: {mode: string}; access: {state: string};
  permissions: {manage_instances: boolean; download_credentials: boolean}}
const backend = useBackendApiStore()
const status = ref<Workshop | null>(null), error = ref(''), message = ref('')
const actionError = ref('')
const loading = ref(false), sending = ref(false)
const pending = ref<{action: string; participant: Participant} | null>(null), confirmation = ref('')
const dialog = ref<HTMLElement | null>(null)
const keyboard = useDialogKeyboard(() => !!pending.value, dialog, () => { if (!sending.value) pending.value = null })
let epoch = 0, timer: ReturnType<typeof setInterval> | undefined
const busy = computed(() => props.disabled || loading.value || sending.value || !!error.value ||
  status.value?.participants.some(person => ['pending', 'running', 'deploying', 'running_attempt'].includes(person.state)))
const canManage = computed(() => !!status.value?.permissions.manage_instances && !busy.value)
const groupSize = computed(() => props.participantsPerEnvironment ?? 1)
watch(() => [props.deploymentId, getBackendScope(), backend.token], () => {
  epoch++; status.value = null; pending.value = null; loading.value = false; sending.value = false
  error.value = ''; actionError.value = ''; message.value = ''; void refresh()
}, {immediate: true})
async function refresh() {
  if (loading.value) return
  const current = epoch
  loading.value = true
  try {
    const result = await backendRequest<Workshop>(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/workshop`)
    if (current === epoch) { status.value = result; error.value = '' }
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : 'Could not load this workshop run.' }
  finally { if (current === epoch) loading.value = false }
}
function confirm(action: string, participant: Participant) {
  if (!canManage.value) return
  confirmation.value = ''; actionError.value = ''; pending.value = {action, participant}
}
async function action(name: string, person: Participant) {
  if (!canManage.value || !status.value?.participants.some(item => item.username === person.username)) return
  if (['reset', 'teardown'].includes(name) && confirmation.value !== person.username) return
  const current = epoch
  sending.value = true; actionError.value = ''; message.value = ''
  try {
    const attempt = await backendRequest<{id: string; state: string}>(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/workshop/participants/${person.username}/actions`, {
      method: 'POST', body: JSON.stringify({action: name, ...(['reset', 'teardown'].includes(name) ? {confirmation: person.username} : {})}),
    })
    if (current !== epoch) return
    message.value = `Operation accepted for ${person.username}. Follow attempt ${attempt.id} in the deployment logs.`
    pending.value = null; emit('started', attempt); await refresh()
  } catch (cause) {
    if (current === epoch) {
      actionError.value = cause instanceof Error ? cause.message : 'The participant operation failed.'
      // A lost response may still have started an attempt. Refresh the durable
      // state before offering another action; an active attempt blocks retry.
      await refresh()
    }
  }
  finally { if (current === epoch) sending.value = false }
}
async function handout(person: Participant) {
  if (!status.value?.permissions.download_credentials || sending.value) return
  const current = epoch
  sending.value = true
  try {
    const blob = await backendBlob(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/workshop/participants/${person.username}/handout`)
    if (current !== epoch) return
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = `${status.value.namespace}-${person.username}.pdf`; link.click(); URL.revokeObjectURL(url)
  } catch (cause) { if (current === epoch) actionError.value = cause instanceof Error ? cause.message : 'Could not download the private handout.' }
  finally { if (current === epoch) sending.value = false }
}
onMounted(() => { timer = setInterval(() => { if (!pending.value) void refresh() }, 5000) })
onBeforeUnmount(() => { epoch++; if (timer) clearInterval(timer) })
</script>

<template>
  <section class="my-4 space-y-4" data-testid="workshop-run-participants" aria-labelledby="workshop-run-title">
    <header class="flex flex-wrap justify-between gap-3">
      <div><h2 id="workshop-run-title" class="text-xl font-semibold">{{ groupSize > 1 ? 'Group environments' : 'Participants and access' }}</h2>
        <p v-if="status" class="text-sm">{{ status.namespace }} · {{ status.phase }} · Ends {{ status.expires_at }} (UTC)</p></div>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="refresh">Refresh status</button>
    </header>
    <p v-if="loading && !status" role="status">Loading workshop participants…</p>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="actionError && !pending" role="alert" class="alert alert-error">{{ actionError }}</p>
    <p v-if="message" role="status" class="alert alert-info">{{ message }}</p>
    <p v-if="groupSize > 1" class="text-sm">Up to {{ groupSize }} participants share each environment. Environment credentials are separate from individual identity and laptop access.</p>
    <p v-if="status?.access.state === 'not_configured'" role="status" class="alert alert-warning">Laptop access is not configured. Instance preparation and participant network access are tracked separately.</p>
    <div v-if="status" class="grid gap-4 lg:grid-cols-2">
      <article v-for="person in status.participants" :key="person.username" class="rounded border border-base-300 p-4 space-y-3">
        <header class="flex justify-between gap-2"><h3 class="font-semibold">{{ person.username }}</h3><span class="badge badge-outline">{{ person.state }}</span></header>
        <dl class="grid grid-cols-2 gap-2 text-sm"><dt>Proxmox</dt><dd><a class="link" :href="`https://${person.proxmox_address}:8006`" target="_blank" rel="noopener noreferrer">{{ person.proxmox_address }}</a></dd>
          <dt>Deployer SSH</dt><dd><code>range42@{{ person.deployer_address }}</code></dd></dl>
        <div class="flex flex-wrap gap-2">
          <button v-if="status.permissions.download_credentials" type="button" class="btn btn-sm" :data-testid="`run-handout-${person.username}`" :disabled="sending || loading" @click="handout(person)">Download credentials</button>
          <button type="button" class="btn btn-sm" :disabled="!canManage || person.state !== 'not_created'" @click="action('deploy', person)">Deploy instance</button>
          <button type="button" class="btn btn-sm" :disabled="!canManage || person.state === 'not_created'" @click="action('configure', person)">Check / configure</button>
          <button type="button" class="btn btn-sm" :data-testid="`run-reset-${person.username}`" :disabled="!canManage || person.state === 'not_created'" @click="confirm('reset', person)">Reset instance</button>
          <button type="button" class="btn btn-sm btn-error btn-outline" :disabled="!canManage || person.state === 'retired'" @click="confirm('teardown', person)">Delete instance</button>
        </div>
      </article>
    </div>
    <div v-if="pending" class="modal modal-open" @keydown="keyboard">
      <form ref="dialog" role="dialog" aria-modal="true" aria-labelledby="workshop-action-title" tabindex="-1" class="modal-box space-y-4" @submit.prevent="action(pending.action, pending.participant)">
        <h3 id="workshop-action-title" class="font-semibold text-lg">{{ pending.action === 'reset' ? 'Reset' : 'Delete' }} {{ pending.participant.username }}?</h3>
        <p v-if="groupSize > 1">This affects {{ groupSize === 2 ? 'both members' : 'all members' }} of this group. Its installed labs and data will be lost. Other group environments are retained.</p>
        <p v-else>This replaces or deletes only the selected participant's environment. Its installed labs and data will be lost.</p>
        <p v-if="actionError" role="alert" class="alert alert-error">{{ actionError }}</p>
        <label class="form-control gap-2"><span>Type {{ pending.participant.username }} to confirm</span>
          <input v-model="confirmation" class="input input-bordered" data-testid="run-confirm-participant" autocomplete="off" /></label>
        <div class="modal-action"><button type="button" class="btn" :disabled="sending" @click="pending = null">Cancel</button>
          <button type="submit" class="btn btn-error" data-testid="run-confirm-action" :disabled="sending || !canManage || confirmation !== pending.participant.username">Confirm</button></div>
      </form>
    </div>
  </section>
</template>

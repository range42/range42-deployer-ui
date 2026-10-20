<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useDialogKeyboard } from '@/composables/useDialogKeyboard'

type Person = {id: string; kind: 'temporary' | 'permanent'; enabled: boolean; generation: number; reconcile_state: string}
type Membership = {person_id: string; scope_ref: string; role: string; team_ref: string | null; active: boolean; effective: boolean}
type Reference = {person_id: string; scope_ref: string; record_ref: string}
type Review = {deployment_id: string; expires_at: string; teams: string[]; participants_per_environment?: number; run_revision: string; state: {
  registry_id: string; revision: number; people: Person[]; scopes: {ref: string; expires_at: string; participant_limit_per_team?: number | null}[];
  source_references: Reference[]; memberships: Membership[];
  providers: {id: string; kind: string}[]; bindings: {person_id: string; provider_id: string; subject: string}[];
  jobs: {person_id: string; provider_id: string; state: string; error_code: string | null}[];
}}
const props = defineProps<{deploymentId: string; disabled?: boolean}>()
const backend = useBackendApiStore()
const review = ref<Review | null>(null), loading = ref(false), sending = ref(false)
const error = ref(''), notice = ref(''), role = ref('')
const integrationState = ref('')
const alias = ref(''), kind = ref<'temporary' | 'permanent'>('temporary'), returningPerson = ref('')
const selectedPerson = ref(''), membershipRole = ref('participant'), team = ref('')
const pending = ref<{person: Person; alias: string} | null>(null), confirmation = ref('')
const dialog = ref<HTMLElement | null>(null)
const keyboard = useDialogKeyboard(() => !!pending.value, dialog, () => { if (!sending.value) pending.value = null })
let generation = 0, controller: AbortController | null = null
function reset() {
  generation++; controller?.abort(); controller = null
  review.value = null; loading.value = false; sending.value = false; role.value = ''
  error.value = ''; notice.value = ''; alias.value = ''; kind.value = 'temporary'; returningPerson.value = ''
  integrationState.value = ''
  selectedPerson.value = ''; membershipRole.value = 'participant'; team.value = ''; pending.value = null; confirmation.value = ''
}
watch(() => JSON.stringify([props.deploymentId, backend.activeHost?.id, getBackendScope(), backend.token]), reset, {flush: 'sync'})
onBeforeUnmount(reset)
const busy = computed(() => !!props.disabled || loading.value || sending.value)
const initialized = computed(() => review.value?.state.scopes.some(scope => scope.ref === props.deploymentId))
const runPeople = computed(() => {
  const state = review.value?.state
  if (!state) return []
  const ids = new Set([...state.source_references.filter(row => row.scope_ref === props.deploymentId).map(row => row.person_id),
    ...state.memberships.filter(row => row.scope_ref === props.deploymentId).map(row => row.person_id)])
  return state.people.filter(person => ids.has(person.id))
})
function label(person: Person) {
  return review.value?.state.source_references.find(row => row.scope_ref === props.deploymentId && row.person_id === person.id)?.record_ref || person.id
}
function returningLabel(person: Person) {
  const refs = review.value?.state.source_references.filter(row => row.person_id === person.id) || []
  return `${refs.map(row => `${row.scope_ref}: ${row.record_ref}`).join(', ') || 'Person'} · ${person.id}`
}
function seatOccupied(seat: string) {
  const limit = review.value?.participants_per_environment ?? 1
  const members = review.value?.state.memberships.filter(row => row.scope_ref === props.deploymentId && row.team_ref === seat
    && row.role === 'participant' && row.effective && row.person_id !== selectedPerson.value) || []
  return new Set(members.map(row => row.person_id)).size >= limit
}
function membership(person: Person) {
  return review.value?.state.memberships.find(row => row.person_id === person.id && row.scope_ref === props.deploymentId)
}
function reconcileLabel(person: Person) {
  return ({unconfigured: 'Unconfigured', pending: 'Pending', partial: 'Partially reconciled', failed: 'Reconciliation failed', synchronized: 'Synchronized'} as Record<string, string>)[person.reconcile_state] || 'Unknown'
}
function integrationStatus(person: Person) {
  const state = review.value?.state
  if (!state) return []
  return state.bindings.filter(row => row.person_id === person.id).map(binding => ({id: binding.provider_id,
    kind: state.providers.find(provider => provider.id === binding.provider_id)?.kind || 'integration',
    status: state.jobs.find(job => job.person_id === person.id && job.provider_id === binding.provider_id)?.state || 'Not reconciled'}))
}
function accept(value: Review) {
  if (value.deployment_id !== props.deploymentId || !value.state || !Array.isArray(value.state.people)) {
    throw new Error('The identity review does not match this deployment. Refresh to retry.')
  }
  const limit = value.participants_per_environment ?? 1
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 || value.state.scopes.some(scope =>
    scope.ref === props.deploymentId && (scope.participant_limit_per_team ?? 1) !== limit)) {
    throw new Error('The roster policy differs from the saved group size. Refresh the integration review.')
  }
  review.value = value
}
async function refresh() {
  if (busy.value) return
  const current = generation
  loading.value = true; error.value = ''; notice.value = ''; review.value = null; integrationState.value = ''; controller = new AbortController()
  try {
    const identity = await backendRequest<{role: string}>('/v1/auth/me', {signal: controller.signal})
    if (current !== generation) return
    role.value = identity.role
    if (identity.role !== 'admin') throw new Error('Administrator access is required to manage run identities.')
    const capability = await backendRequest<{deployment_id: string; optional: boolean; configuration_state: string;
      provider_access_verified: boolean; required_for_environment_deployment: boolean}>(
      `/v1/deployments/${encodeURIComponent(props.deploymentId)}/identities/capabilities`, {signal: controller.signal})
    if (current !== generation) return
    if (capability.deployment_id !== props.deploymentId || capability.optional !== true
      || capability.provider_access_verified !== false || capability.required_for_environment_deployment !== false
      || !['configured', 'not_configured', 'invalid_configuration'].includes(capability.configuration_state)) {
      throw new Error('Could not verify the optional onboarding configuration. Environment deployment is independent.')
    }
    integrationState.value = capability.configuration_state
    if (capability.configuration_state !== 'configured') return
    const value = await backendRequest<Review>(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/identities`, {signal: controller.signal})
    if (current === generation) accept(value)
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : 'Could not load the identity review.' }
  finally { if (current === generation) loading.value = false }
}
async function change(operation: Record<string, unknown>) {
  if (busy.value || role.value !== 'admin' || !review.value) return
  const current = generation, proof = review.value
  sending.value = true; error.value = ''; notice.value = ''
  controller = new AbortController()
  try {
    const value = await backendRequest<Review>(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/identities`, {
      method: 'POST', signal: controller.signal, body: JSON.stringify({registry_id: proof.state.registry_id,
        expected_revision: proof.state.revision, run_revision: proof.run_revision, operation}),
    })
    if (current !== generation) return
    accept(value); pending.value = null
    notice.value = 'Desired identity state saved. Review integration status before handing out access.'
  } catch (cause) {
    if (current === generation) {
      review.value = null; pending.value = null
      error.value = cause instanceof Error ? cause.message : 'The identity change could not be confirmed. Refresh before submitting again.'
    }
  } finally { if (current === generation) sending.value = false }
}
async function registerPerson() {
  if (!initialized.value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(alias.value)) return
  const existing = review.value?.state.people.find(person => person.id === returningPerson.value)
  if (returningPerson.value && !existing) return
  await change({type: 'person.register', record_ref: alias.value, kind: existing?.kind || kind.value, person_id: existing?.id || null})
}
async function assignMembership() {
  if (!initialized.value || !runPeople.value.some(person => person.id === selectedPerson.value && person.enabled)) return
  if ((membershipRole.value === 'participant' && (!team.value || seatOccupied(team.value))) || (team.value && !review.value?.teams.includes(team.value))) return
  await change({type: 'membership.set', person_id: selectedPerson.value, role: membershipRole.value, team_ref: team.value || null})
}
function remove(person: Person) {
  if (busy.value || !membership(person)?.active) return
  pending.value = {person, alias: label(person)}; confirmation.value = ''
}
async function confirmRemoval() {
  if (!pending.value || confirmation.value !== pending.value.alias) return
  await change({type: 'membership.remove', person_id: pending.value.person.id})
}
</script>

<template>
  <section class="my-6 space-y-4 rounded border border-base-300 p-4" aria-labelledby="run-people-title">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="run-people-title" class="text-xl font-semibold">People and memberships</h2>
        <p class="mt-1 text-sm">Register approved people and assign access roles for this saved run.</p></div>
      <button type="button" class="btn btn-sm" data-testid="people-refresh" :disabled="busy" @click="refresh">{{ review ? 'Refresh identity review' : 'Load identity review' }}</button>
    </header>
    <p v-if="loading" role="status">Loading identity review…</p>
    <p v-if="error" role="alert" class="rounded border border-error bg-base-100 p-3 text-base-content">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded border border-info bg-base-100 p-3 text-base-content">{{ notice }}</p>
    <p v-if="integrationState && integrationState !== 'configured'" role="status" class="rounded border border-info bg-base-100 p-3 text-base-content">Managed onboarding is optional. {{ integrationState === 'not_configured' ? 'No identity integration is configured.' : 'The configured identity integration needs administrator attention.' }} Environment deployment does not require this integration. Login and laptop access have not been verified.</p>
    <template v-if="review && role === 'admin'">
      <p class="text-sm">Access ends {{ review.expires_at }} (UTC). Registry revision {{ review.state.revision }}.</p>
      <p role="status" class="rounded border border-warning bg-base-100 p-3 text-base-content">Login and laptop access require verified integrations. A saved membership records desired access; each integration must confirm it.</p>
      <button v-if="!initialized" type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="change({type: 'scope.register'})">Initialize run roster</button>
      <template v-else>
        <form class="space-y-3 rounded border border-base-300 p-4" data-testid="person-register-form" @submit.prevent="registerPerson">
          <h3 class="font-semibold">Register a person</h3>
          <p class="text-sm">Each run alias belongs to a protected person ID. Select an existing person explicitly when they return.</p>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="form-control gap-1"><span>Alias in this run</span><input v-model="alias" data-testid="person-alias" class="input input-bordered w-full" maxlength="128" required pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}" :disabled="busy" /></label>
            <label class="form-control gap-1"><span id="run-person-identity-label">Person identity</span><select v-model="returningPerson" aria-labelledby="run-person-identity-label" class="select select-bordered w-full" :disabled="busy"><option value="">Create a new person</option><option v-for="person in review.state.people" :key="person.id" :value="person.id">{{ returningLabel(person) }}</option></select></label>
            <label v-if="!returningPerson" class="form-control gap-1"><span>Person type</span><select v-model="kind" class="select select-bordered w-full" :disabled="busy"><option value="temporary">Temporary person</option><option value="permanent">Permanent person</option></select></label>
          </div>
          <button type="submit" class="btn btn-sm btn-primary" :disabled="busy || !alias">Register person</button>
        </form>
        <form v-if="runPeople.length" class="space-y-3 rounded border border-base-300 p-4" data-testid="membership-form" @submit.prevent="assignMembership">
          <h3 class="font-semibold">Assign a run membership</h3>
          <p class="text-sm">Choose a group environment with an available place. Up to {{ review.participants_per_environment ?? 1 }} participants may share each environment. Removing a membership does not reset its environment.</p>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="form-control gap-1"><span>Person</span><select v-model="selectedPerson" data-testid="membership-person" class="select select-bordered w-full" required :disabled="busy"><option value="" disabled>Choose a person</option><option v-for="person in runPeople.filter(item => item.enabled)" :key="person.id" :value="person.id">{{ label(person) }}</option></select></label>
            <label class="form-control gap-1"><span>Run role</span><select v-model="membershipRole" class="select select-bordered w-full" :disabled="busy"><option value="participant">Participant</option><option value="facilitator">Facilitator</option><option value="director">Director</option><option value="observer">Observer</option></select></label>
            <label class="form-control gap-1"><span>Group environment</span><select v-model="team" data-testid="membership-team" class="select select-bordered w-full" :required="membershipRole === 'participant'" :disabled="busy"><option value="">{{ membershipRole === 'participant' ? 'Choose an environment' : 'No environment restriction' }}</option><option v-for="seat in review.teams" :key="seat" :value="seat" :disabled="membershipRole === 'participant' && seatOccupied(seat)">{{ seat }}{{ membershipRole === 'participant' && seatOccupied(seat) ? ' (full)' : '' }}</option></select></label>
          </div>
          <button type="submit" class="btn btn-sm" :disabled="busy || !selectedPerson || (membershipRole === 'participant' && (!team || seatOccupied(team)))">Save membership</button>
        </form>
        <div v-if="runPeople.length" class="overflow-x-auto focus-visible:outline focus-visible:outline-primary" tabindex="0" role="region" aria-label="Run roster table">
          <table class="table"><caption class="text-left font-semibold">People registered for this run</caption>
            <thead><tr><th scope="col">Person</th><th scope="col">Desired membership</th><th scope="col">Integrations</th><th scope="col">Action</th></tr></thead>
            <tbody><tr v-for="person in runPeople" :key="person.id">
              <th scope="row"><span>{{ label(person) }}</span><code class="block break-all text-xs font-normal">{{ person.id }}</code><span v-if="!person.enabled" class="block">Person disabled</span></th>
              <td>{{ membership(person)?.effective ? `${membership(person)?.role} · ${membership(person)?.team_ref || 'No seat restriction'}` : 'No current membership' }}</td>
              <td><span>{{ reconcileLabel(person) }}</span><ul v-if="integrationStatus(person).length" class="text-sm"><li v-for="integration in integrationStatus(person)" :key="integration.id">{{ integration.id }} ({{ integration.kind }}): {{ integration.status }}</li></ul></td>
              <td><button v-if="membership(person)?.active" type="button" class="btn btn-sm btn-outline" data-testid="membership-remove" :disabled="busy" @click="remove(person)">Remove membership</button></td>
            </tr></tbody>
          </table>
        </div>
        <p v-else>No people are registered for this run yet.</p>
      </template>
    </template>
    <div v-if="pending" class="modal modal-open" @keydown="keyboard">
      <form ref="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-membership-title" tabindex="-1" class="modal-box space-y-4" data-testid="membership-remove-form" @submit.prevent="confirmRemoval">
        <h3 id="remove-membership-title" class="text-lg font-semibold">Remove {{ pending.alias }} from this run?</h3>
        <p>This removes the desired role for this run and queues its integration updates. The person record and other runs' memberships are retained.</p>
        <label class="form-control gap-1"><span>Type {{ pending.alias }} to confirm</span><input v-model="confirmation" data-testid="membership-confirm-alias" class="input input-bordered" autocomplete="off" :disabled="sending" /></label>
        <div class="modal-action"><button type="button" class="btn" :disabled="sending" @click="pending = null">Cancel</button><button type="submit" class="btn btn-error" data-testid="membership-confirm-remove" :disabled="busy || confirmation !== pending.alias">Remove membership</button></div>
      </form>
    </div>
  </section>
</template>

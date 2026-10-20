<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

type Phase = 'unimported' | 'pending_controller' | 'claim_saved' | 'active' | 'released'
interface Assignment { instance_id: string; vm_id: number; vm_name: string }
interface Status {
  deployment_id: string; phase: Phase; import_id: string | null; allocation_id: string | null;
  assignments: Assignment[]; resume_review_revision: string | null; changed_by: string | null;
  capacity_borrowing_allowed: false; remote_quiescence_verified: false;
}
interface Review {
  deployment_id: string; revision: string;
  witness: {cohort: {id: string}; assignments: Assignment[]; review_revision: string};
  capacity_borrowing_allowed: false; remote_quiescence_verified: false;
}
const props = defineProps<{deploymentId: string; disabled?: boolean}>()
const emit = defineEmits<{changed: [phase: Phase | null]}>()
const backend = useBackendApiStore()
const state = ref<Status | null>(null), review = ref<Review | null>(null)
const loading = ref(false), role = ref(''), error = ref('')
const activity = ref('')
const busy = computed(() => loading.value || !!props.disabled)
let generation = 0, controller: AbortController | null = null
const url = () => `/v1/deployments/${encodeURIComponent(props.deploymentId)}/allocations/import`
const pending = computed(() => state.value && ['pending_controller','claim_saved'].includes(state.value.phase))
const rows = computed(() => review.value?.witness.assignments || state.value?.assignments || [])
const hash = (value: unknown, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value)
function invalid(): never {throw new Error('The original ownership response could not be verified. Refresh before continuing.')}
function checkRows(value: Assignment[]) {
  if (!Array.isArray(value) || value.length > 256 || new Set(value.map(row=>row.vm_id)).size !== value.length
      || value.some(row=>!row || !Number.isSafeInteger(row.vm_id) || row.vm_id < 100 || row.vm_id > 999999999
        || typeof row.instance_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(row.instance_id)
        || typeof row.vm_name !== 'string' || !row.vm_name.length || row.vm_name.length > 128)) invalid()
}
function checkBase(value: Status | Review) {
  if (!value || value.deployment_id !== props.deploymentId || value.capacity_borrowing_allowed !== false
      || value.remote_quiescence_verified !== false) invalid()
}
function accept(value: Status) {
  checkBase(value);checkRows(value.assignments)
  if (!['unimported','pending_controller','claim_saved','active','released'].includes(value.phase)
      || (value.phase !== 'unimported' && !hash(value.import_id,32))
      || (['claim_saved','active','released'].includes(value.phase) && (!hash(value.allocation_id,32) || !value.assignments.length))
      || (['pending_controller','claim_saved'].includes(value.phase) && !hash(value.resume_review_revision))) invalid()
  state.value = value;review.value = null;emit('changed',value.phase)
}
function reset() {
  generation++;controller?.abort();controller=null
  state.value=null;review.value=null;loading.value=false;role.value='';error.value='';activity.value='';emit('changed',null)
}
watch(()=>[props.deploymentId,backend.activeHost?.id,getBackendScope(),backend.token],reset,{flush:'sync'})
onBeforeUnmount(()=>{generation++;controller?.abort()})
async function refresh() {
  if (busy.value) return
  const current = generation
  state.value=null;review.value=null;role.value='';error.value='';loading.value=true;controller=new AbortController();emit('changed',null)
  activity.value='Reading retained ownership…'
  try {
    const identity=await backendRequest<{role:string}>('/v1/auth/me',{signal:controller.signal})
    if(current!==generation)return
    role.value=identity.role
    if(identity.role!=='admin')return
    const result=await backendRequest<Status>(url(),{signal:controller.signal})
    if(current===generation)accept(result)
  } catch(cause) {if(current===generation)error.value=cause instanceof Error?cause.message:'Could not read original ownership.'}
  finally {if(current===generation)loading.value=false}
}
async function inspect() {
  if(busy.value || role.value!=='admin' || state.value?.phase!=='unimported')return
  const current=generation
  review.value=null;error.value='';loading.value=true;controller=new AbortController()
  activity.value='Verifying original guests and their current configuration…'
  try {
    const result=await backendRequest<Review>(url()+'/review',{method:'POST',body:'{}',signal:controller.signal})
    if(current!==generation)return
    checkBase(result);checkRows(result.witness?.assignments)
    if(!hash(result.revision) || result.witness?.cohort.id!==props.deploymentId || !hash(result.witness.review_revision) || !result.witness.assignments.length)invalid()
    review.value=result
  } catch(cause) {if(current===generation)error.value=cause instanceof Error?cause.message:'Could not review original guests.'}
  finally {if(current===generation)loading.value=false}
}
async function save() {
  const revision=pending.value?state.value?.resume_review_revision:review.value?.revision
  if(busy.value || role.value!=='admin' || !hash(revision))return
  const current=generation
  error.value='';loading.value=true;controller=new AbortController()
  activity.value='Saving ownership and confirming the handoff…'
  try {
    const result=await backendRequest<Status>(url(),{method:'POST',body:JSON.stringify({review_revision:revision}),signal:controller.signal})
    if(current===generation)accept(result)
  } catch(cause) {
    if(current!==generation)return
    error.value=cause instanceof Error?cause.message:'The ownership handoff could not be confirmed.'
    review.value=null;state.value=null;emit('changed',null)
    // A lost reply can follow a committed claim. Read retained state, without
    // replaying either side of the handoff or starting a lifecycle operation.
    try {const result=await backendRequest<Status>(url(),{signal:controller.signal});if(current===generation)accept(result)} catch { /* Refresh explicitly to recover. */ }
  } finally {if(current===generation)loading.value=false}
}
</script>

<template>
  <section class="rounded border border-base-300 p-4 mb-4 space-y-3" aria-labelledby="native-ownership-title">
    <h2 id="native-ownership-title" class="font-semibold">Existing workshop ownership</h2>
    <p class="text-sm">Review the original guest records and import their ownership into this deployment. Participant actions then use this parent allocation.</p>
    <p class="text-sm">Importing ownership does not pause VM actions or make capacity available. Pause participant management before reviewing the existing guests.</p>
    <button type="button" class="btn btn-sm" data-testid="ownership-refresh" :disabled="busy" @click="refresh">{{ state ? 'Refresh ownership' : 'Review existing ownership' }}</button>
    <p v-if="loading" role="status" data-testid="ownership-progress">{{ activity }}</p>
    <p v-if="role && role !== 'admin'" role="status">An administrator must review and import original ownership.</p>
    <template v-if="state">
      <p v-if="state.phase === 'unimported'" role="status">Original ownership has not been imported.</p>
      <p v-else-if="pending" role="status">Ownership handoff is incomplete. Finish the retained handoff after reviewing its current state.</p>
      <p v-else-if="state.phase === 'active'" role="status">Ownership acknowledged · participant actions use the canonical parent allocation.</p>
      <p v-else role="status">Original resources were retired. The retained ownership record prevents an old controller from recreating them.</p>
      <p v-if="state.changed_by" class="text-sm">Recorded by {{ state.changed_by }}</p>
      <button v-if="state.phase === 'unimported'" type="button" class="btn btn-sm" data-testid="ownership-review" :disabled="busy" @click="inspect">Inspect original guests</button>
      <button v-if="pending" type="button" class="btn btn-sm btn-primary" data-testid="ownership-finish" :disabled="busy" @click="save">Finish ownership handoff</button>
    </template>
    <div v-if="rows.length" class="overflow-x-auto">
      <table class="table table-sm"><caption class="text-left">{{ review ? 'Verified original guests for this deployment' : 'Retained guest ownership' }}</caption>
        <thead><tr><th scope="col">Participant</th><th scope="col">VM ID</th><th scope="col">Guest</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.vm_id"><td>{{ row.instance_id }}</td><td>{{ row.vm_id }}</td><td class="break-all">{{ row.vm_name }}</td></tr></tbody>
      </table>
    </div>
    <button v-if="review" type="button" class="btn btn-sm btn-primary" data-testid="ownership-save" :disabled="busy" @click="save">Import reviewed ownership</button>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { reserveFoundationAllocation } from '@/services/scenarioAllocation'
import type { NativeTopology } from '@/services/nativeScenarioCanvas'
import type {ScenarioAllocationSelection} from '@/services/scenarioAllocation'

import {templatesFor, type PreparationProfile} from '@/services/provisioning'
export type FoundationSpec = {namespace: string; source_node: string; proxmox_source: number; deployer_source: number} | {namespace: string; source_node: string; sources: Record<string,number>}
export interface FoundationSelection {foundation: FoundationSpec; topology: NativeTopology; allocation: ScenarioAllocationSelection; prepare_environment_networks?: true}
const props = defineProps<{projectId: string; revision: string; path: string; componentId?: string;
  contextId: string; targetHostId: string; profile?: PreparationProfile | null; kind?: string}>()
const emit = defineEmits<{select: [value: FoundationSelection | null]}>()
const backend = useBackendApiStore()
const draftKey = `foundation-${crypto.randomUUID()}`
const generic = computed(() => props.kind === 'native-template-preparation')
const templates = computed(() => templatesFor(props.profile))
const fields = computed(() => [
  {name:'namespace',label:'Foundation name',type:'text'},
  {name:'source_node',label:'Original template node',type:'text'},
  ...(generic.value ? Object.keys(templates.value).sort().map(role => ({name:`source-${role}`,label:`Original ${role} template VMID`,type:'number'})) : [
    {name:'proxmox_source',label:'Original nested Proxmox template VMID',type:'number'},
    {name:'deployer_source',label:'Original Linux template VMID',type:'number'}]),
])
const input = reactive<Record<string,string>>({namespace:'template-base',source_node:'',proxmox_source:'',deployer_source:''})
const capacity = computed(() => {
  const values=Object.values(templates.value)
  return {memory:values.reduce((sum,row)=>sum+row.memory_mib,0)/1024,cores:values.reduce((sum,row)=>sum+row.cores,0),disk:values.reduce((sum,row)=>sum+row.disks_gib.reduce((a,b)=>a+b,0),0)}
})
const busy = ref(false), error = ref(''), reviewed = ref(false)
const prepareNetworks = ref(false)
const canPrepareNetworks = computed(() => /^env-[0-9a-f]{24}$/.test(props.contextId) && !!props.profile?.managed_gateway)
let epoch = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
const specification = computed<FoundationSpec | null>(() => {
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(input.namespace || '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.source_node || '')) return null
  const roles=Object.keys(templates.value).sort()
  if (!roles.length) return null
  const sources=Object.fromEntries(roles.map(role=>[role,Number(input[generic.value ? `source-${role}` : `${role}_source`])]))
  const ids=Object.values(sources), outputs=Object.values(templates.value).map(row=>row.vm_id)
  if (ids.some(id=>!Number.isSafeInteger(id)||id<(generic.value?100:1000)||id>999999999||outputs.includes(id)) || new Set(ids).size!==ids.length) return null
  return generic.value ? {namespace:input.namespace!,source_node:input.source_node!,sources} :
    {namespace:input.namespace!,source_node:input.source_node!,proxmox_source:sources.proxmox!,deployer_source:sources.deployer!}
})
function invalidate() {
  epoch++; clearTimeout(expiryTimer); busy.value = false; reviewed.value = false; error.value = ''; emit('select', null)
}
watch(input, invalidate, {deep: true})
watch(prepareNetworks, invalidate)
watch(canPrepareNetworks, available => {if (!available) prepareNetworks.value = false})
watch(() => [props.projectId, props.revision, props.path, props.componentId, props.contextId, props.targetHostId,
  props.profile, props.kind, getBackendScope(), backend.token], invalidate, {deep: true})
async function review() {
  if (!specification.value || !props.contextId || !props.targetHostId || busy.value) return
  const request = ++epoch, foundation = {...specification.value}, scope = getBackendScope()
  const target = props.targetHostId, contextId = props.contextId
  busy.value = true; error.value = ''; reviewed.value = false; emit('select', null)
  try {
    const result = await backendRequest<{topology: NativeTopology}>(`/v1/projects/${encodeURIComponent(props.projectId)}/native-scenario/foundation/preview`, {
      method: 'POST', body: JSON.stringify({sha: props.revision, path: props.path, foundation,
        context_id: contextId, target_host_id: target, ...(prepareNetworks.value ? {prepare_environment_networks:true} : {}), ...(props.componentId ? {component_id: props.componentId} : {})}),
    })
    if (request !== epoch) return
    const reservation = await reserveFoundationAllocation({projectId: props.projectId, projectKey: draftKey,
      targetHostId: target, contextId, sha: props.revision, path: props.path, componentId: props.componentId, foundation, prepareEnvironmentNetworks:prepareNetworks.value})
    if (request !== epoch) return
    const remaining = Date.parse(reservation.expires_at) - Date.now()
    if (remaining <= 0) throw new Error('Reservation expired; review and reserve again.')
    expiryTimer = setTimeout(() => { invalidate(); error.value = 'Reservation expired; review and reserve again.' }, remaining)
    reviewed.value = true
    emit('select', {foundation, topology: result.topology, allocation: {backend_url: scope, target_host_id: target, reservation},
      ...(prepareNetworks.value && canPrepareNetworks.value ? {prepare_environment_networks: true as const} : {})})
  } catch (cause) { if (request === epoch) error.value = cause instanceof Error ? cause.message : 'Template review failed.' }
  finally { if (request === epoch) busy.value = false }
}
onBeforeUnmount(() => {epoch++; clearTimeout(expiryTimer)})
</script>

<template>
  <fieldset class="min-w-0 space-y-4 rounded border border-base-300 p-3" data-testid="foundation-setup">
    <legend class="font-medium">Reusable templates</legend>
    <p class="text-sm">Prepare this foundation once. It owns the reviewed template copies for later deployments. The original templates stay unchanged.</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="field in fields" :key="field.name" class="flex min-w-0 flex-col form-control gap-1">
        <span>{{ field.label }}</span>
        <input v-model="input[field.name]" :type="field.type" :min="field.type === 'number' ? (generic ? 100 : 1000) : undefined"
          :max="field.type === 'number' ? 999999999 : undefined" required class="input input-bordered w-full"
          :data-testid="`foundation-input-${field.name}`" />
      </label>
    </div>
    <p v-if="profile" class="text-sm">Destination copies: {{ Object.entries(templates).map(([role,row]) => `${role} ${row.vm_id}`).join(' · ') }} on {{ profile.storage }}. {{ capacity.memory }} GiB configured RAM · {{ capacity.cores }} vCPUs · {{ capacity.disk }} GiB disks plus cloud-init.</p>
    <label class="flex items-start gap-2 text-sm">
      <input v-model="prepareNetworks" type="checkbox" class="checkbox checkbox-sm" data-testid="foundation-prepare-networks" :disabled="!canPrepareNetworks || busy" />
      <span>Also prepare the environment’s isolated bridges and gateway management network.</span>
    </label>
    <p v-if="prepareNetworks" class="text-sm">The environment owns these bridges. This uses a separate optional node module. Review its bridge request in Overview, then run the same full deployment action. Gateway creation has its own deployment ownership.</p>
    <p v-else-if="!canPrepareNetworks" class="text-sm">Choose a registered environment with a managed gateway network to include bridge preparation.</p>
    <p class="text-sm">The node must have the optional preparation module enrolled for these exact sources before execution. Bridges and each run’s gateway have separate ownership.</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p role="status" class="text-sm">{{ reviewed ? 'Template copy IDs are reserved. Create the deployment, then review its physical capacity in Overview.' : 'Review and reserve the template copy IDs before creating the deployment.' }}</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="foundation-review-plan"
      :disabled="busy || !specification || !targetHostId || !contextId" @click="review">{{ busy ? 'Checking and reserving…' : 'Review and reserve template copies' }}</button>
  </fieldset>
</template>

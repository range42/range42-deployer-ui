<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { reserveFoundationAllocation } from '@/services/scenarioAllocation'
import type { NativeTopology } from '@/services/nativeScenarioCanvas'
import type { WorkshopSelection, ProvisioningProfile } from './WorkshopRunSetup.vue'

export interface FoundationSpec {namespace: string; source_node: string; proxmox_source: number; deployer_source: number}
export interface FoundationSelection {foundation: FoundationSpec; topology: NativeTopology; allocation: WorkshopSelection['allocation']; prepare_environment_networks?: true}
const props = defineProps<{projectId: string; revision: string; path: string; componentId?: string;
  contextId: string; targetHostId: string; profile?: ProvisioningProfile | null}>()
const emit = defineEmits<{select: [value: FoundationSelection | null]}>()
const backend = useBackendApiStore()
const draftKey = `foundation-${crypto.randomUUID()}`
const fields = [
  {name: 'namespace', label: 'Foundation name', type: 'text'},
  {name: 'source_node', label: 'Original template node', type: 'text'},
  {name: 'proxmox_source', label: 'Original nested Proxmox template VMID', type: 'number'},
  {name: 'deployer_source', label: 'Original Linux template VMID', type: 'number'},
] as const
const input = reactive({namespace: 'workshop-base', source_node: '', proxmox_source: '', deployer_source: ''})
const busy = ref(false), error = ref(''), reviewed = ref(false)
const prepareNetworks = ref(false)
const canPrepareNetworks = computed(() => /^env-[0-9a-f]{24}$/.test(props.contextId) && !!props.profile?.managed_gateway)
let epoch = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
const specification = computed<FoundationSpec | null>(() => {
  const ids = [Number(input.proxmox_source), Number(input.deployer_source)]
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(input.namespace) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(input.source_node)
    || ids.some(id => !Number.isSafeInteger(id) || id < 1000 || id > 999999999)
    || ids[0] === ids[1] || !props.profile?.proxmox_template || !props.profile?.deployer_template
    || ids.some(id => [props.profile!.proxmox_template, props.profile!.deployer_template].includes(id))) return null
  return {namespace: input.namespace, source_node: input.source_node, proxmox_source: ids[0]!, deployer_source: ids[1]!}
})
function invalidate() {
  epoch++; clearTimeout(expiryTimer); busy.value = false; reviewed.value = false; error.value = ''; emit('select', null)
}
watch(input, invalidate, {deep: true})
watch(prepareNetworks, invalidate)
watch(canPrepareNetworks, available => {if (!available) prepareNetworks.value = false})
watch(() => [props.projectId, props.revision, props.path, props.componentId, props.contextId, props.targetHostId,
  props.profile, getBackendScope(), backend.token], invalidate, {deep: true})
async function review() {
  if (!specification.value || !props.contextId || !props.targetHostId || busy.value) return
  const request = ++epoch, foundation = {...specification.value}, scope = getBackendScope()
  const target = props.targetHostId, contextId = props.contextId
  busy.value = true; error.value = ''; reviewed.value = false; emit('select', null)
  try {
    const result = await backendRequest<{topology: NativeTopology}>(`/v1/projects/${encodeURIComponent(props.projectId)}/native-scenario/foundation/preview`, {
      method: 'POST', body: JSON.stringify({sha: props.revision, path: props.path, foundation,
        context_id: contextId, target_host_id: target, ...(props.componentId ? {component_id: props.componentId} : {})}),
    })
    if (request !== epoch) return
    const reservation = await reserveFoundationAllocation({projectId: props.projectId, projectKey: draftKey,
      targetHostId: target, contextId, sha: props.revision, path: props.path, componentId: props.componentId, foundation})
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
    <legend class="font-medium">Reusable workshop templates</legend>
    <p class="text-sm">Prepare this foundation once. It owns two isolated template copies that later workshop runs use. The original templates stay unchanged.</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <label v-for="field in fields" :key="field.name" class="flex min-w-0 flex-col form-control gap-1">
        <span>{{ field.label }}</span>
        <input v-model="input[field.name]" :type="field.type" :min="field.type === 'number' ? 1000 : undefined"
          :max="field.type === 'number' ? 999999999 : undefined" required class="input input-bordered w-full"
          :data-testid="`foundation-input-${field.name}`" />
      </label>
    </div>
    <p v-if="profile" class="text-sm">Destination copies: {{ profile.proxmox_template }} and {{ profile.deployer_template }} on {{ profile.storage }}. 20 GiB configured RAM · 6 vCPUs · 192 GiB disks plus cloud-init.</p>
    <label class="flex items-start gap-2 text-sm">
      <input v-model="prepareNetworks" type="checkbox" class="checkbox checkbox-sm" data-testid="foundation-prepare-networks" :disabled="!canPrepareNetworks || busy" />
      <span>Also prepare the environment’s isolated bridges and gateway management network.</span>
    </label>
    <p v-if="prepareNetworks" class="text-sm">The environment owns these bridges. This uses a separate optional node module. Review its bridge request in Overview, then run the same full deployment action. Each workshop run creates its own gateway.</p>
    <p v-else-if="!canPrepareNetworks" class="text-sm">Choose a registered environment with a managed gateway network to include bridge preparation.</p>
    <p class="text-sm">The node must have the optional preparation module enrolled for these exact sources before execution. Bridges and each run’s gateway have separate ownership.</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p role="status" class="text-sm">{{ reviewed ? 'Template copy IDs are reserved. Create the deployment, then review its physical capacity in Overview.' : 'Review and reserve the two template copy IDs before creating the deployment.' }}</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="foundation-review-plan"
      :disabled="busy || !specification || !targetHostId || !contextId" @click="review">{{ busy ? 'Checking and reserving…' : 'Review and reserve template copies' }}</button>
  </fieldset>
</template>

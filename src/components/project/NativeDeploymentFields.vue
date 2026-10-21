<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

import NativeScenarioPreview from '@/components/catalog/NativeScenarioPreview.vue'
import WorkshopRunSetup, { type WorkshopSpec, type WorkshopSelection, type ProvisioningProfile } from './WorkshopRunSetup.vue'
import WorkshopTemplatePreview from '@/components/catalog/WorkshopTemplatePreview.vue'
import FoundationSetup, { type FoundationSpec, type FoundationSelection } from './FoundationSetup.vue'
import type { NativeTopology } from '@/services/nativeScenarioCanvas'

const topology = ref<NativeTopology | null>(null)
const props = defineProps<{ projectId: string; revision: string; path: string; componentId?: string }>()
const emit = defineEmits<{ select: [selection: null | { context_id: string; target_host_id: string; features: Record<string, boolean>; parameters: Record<string, string | number | boolean>; workshop?: WorkshopSpec; foundation?: FoundationSpec; allocation?: WorkshopSelection['allocation'] }] }>()
const { t } = useI18n()
const backend = useBackendApiStore()
type Context = { id: string; label: string; target_host_id: string; ready: boolean; issues: string[];
  workshop_profile?: ProvisioningProfile | null; purpose?: 'native' | 'workshop'; execution_ready?: boolean }
type Feature = { id: string; label?: string; description?: string; default: boolean }
type Platform = { id: string; domain: string; profile: string; unavailable: Record<string, string>;
  presets: { id: string; features: Record<string, boolean> }[];
  parameters: { name: string; label: string; type: string; required: boolean }[] }
const platform = ref<Platform | null>(null)
const runDescriptor = ref<{version: number; kind: string; title: string; min_seats: number; max_seats: number} | null>(null)
const runSelection = ref<WorkshopSelection | null>(null)
const foundationDescriptor = ref<{version: number; kind: string; title: string} | null>(null)
const foundationSelection = ref<FoundationSelection | null>(null)
const requiresProfile = computed(() => !!runDescriptor.value || !!foundationDescriptor.value)
const setup = ref<Record<string, string>>({})
const contexts = ref<Context[]>([])
const features = ref<Feature[]>([])
const selected = ref('')
const flags = ref<Record<string, boolean>>({})
const parametersText = ref('{}')
const isWorkshop = computed(() => !runDescriptor.value && props.path === 'scenarios/range42-native-workshop')
const workshopSeat = ref(0)
const workshopAccepted = ref<Record<string, boolean>>({})
const workshopChecks = [
  {id: 'NETWORK', label: 'Participant bridges and host isolation have been verified.'},
  {id: 'TEMPLATE', label: 'The nested Proxmox template has been validated.'},
  {id: 'ALLOCATION', label: 'The declared VMIDs, addresses and host capacity are allocated to this workshop.'},
]
const workshopValid = computed(() => !isWorkshop.value || (workshopChecks.every(check => workshopAccepted.value[check.id])
  && workshopSeat.value <= (flags.value.EXTRA_SEATS ? 10 : 5)))
const busy = ref(false)
const error = ref('')
const reservationNotice = ref('')
let epoch = 0
const context = computed(() => contexts.value.find(item => item.id === selected.value))
const parameters = computed(() => {
  try {
    const advanced = JSON.parse(parametersText.value)
    if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) return null
    const value = { ...advanced, ...Object.fromEntries(Object.entries(setup.value).filter(([, v]) => v.trim())),
      ...(isWorkshop.value ? {WORKSHOP_ONLY_SEAT: workshopSeat.value, ...Object.fromEntries(workshopChecks.map(check => [`WORKSHOP_${check.id}_ACCEPTED`, !!workshopAccepted.value[check.id]]))} : {}) }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 64
      || JSON.stringify(value).length > 16384 || Object.entries(value).some(([name, item]) =>
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || /^(ansible_|range42_|r42_|proxmox_|deployer_|infrastructure_|install_)/i.test(name)
        || /(?:^|_)(?:password|passphrase|secret|token|private_key|api_key)(?:_|$)/i.test(name)
        || (typeof item === 'number' && !Number.isFinite(item))
        || !['string', 'number', 'boolean'].includes(typeof item) || /{{|{%|{#/.test(String(item)))) return null
    for (const field of platform.value?.parameters || []) {
      const entry = value[field.name]
      if (field.required && (typeof entry !== 'string' || !entry.trim())) return null
      if (entry && field.type === 'path' && !String(entry).startsWith('/')) return null
      if (entry && field.type === 'url') {
        const url = new URL(String(entry))
        if (url.protocol !== 'https:' || url.username || url.password) return null
      }
      if (entry && field.type === 'cidrs') {
        const networks = JSON.parse(String(entry))
        if (!Array.isArray(networks) || networks.some(v => typeof v !== 'string')) return null
      }
    }
    return value as Record<string, string | number | boolean>
  } catch { return null }
})
watch(() => [props.projectId, props.revision, props.path, props.componentId, getBackendScope(), backend.token], async () => {
  const request = ++epoch
  contexts.value = []; features.value = []; selected.value = ''; flags.value = {}; error.value = ''; busy.value = true
  workshopSeat.value = 0; workshopAccepted.value = {}; topology.value = null; platform.value = null; setup.value = {}; parametersText.value = '{}'
  runDescriptor.value = null; runSelection.value = null; foundationDescriptor.value = null; foundationSelection.value = null
  reservationNotice.value = ''
  emit('select', null)
  try {
    const query = new URLSearchParams({ sha: props.revision, path: props.path })
    if (props.componentId) query.set('component_id', props.componentId)
    const [environments, descriptor] = await Promise.all([
      backendRequest<{ items: Context[] }>('/v1/contexts'),
      backendRequest<{ features: Feature[]; platform?: Platform; topology?: NativeTopology; workshop?: typeof runDescriptor.value; preparation?: typeof foundationDescriptor.value }>(`/v1/projects/${encodeURIComponent(props.projectId)}/native-scenario?${query}`),
    ])
    if (request !== epoch) return
    const registry = descriptor.topology?.reservations
    if (registry && ['conflict', 'invalid'].includes(registry.status)) throw new Error(registry.issues.join(' '))
    if (registry) reservationNotice.value = registry.status === 'checked'
      ? 'Declared VMIDs and addresses match the scenario registry. Preflight checks the selected Proxmox host before execution.' : registry.issues.join(' ')
    topology.value = descriptor.topology || null
    contexts.value = environments.items
    features.value = descriptor.features
    platform.value = descriptor.platform || null
    runDescriptor.value = descriptor.workshop || null
    foundationDescriptor.value = descriptor.preparation || null
    flags.value = Object.fromEntries(descriptor.features.map(feature => [feature.id, feature.default]))
    const ready = contexts.value.filter(item => item.ready && (requiresProfile.value ? item.workshop_profile : item.purpose !== 'workshop'))
    if (ready.length === 1) selected.value = ready[0]!.id
  } catch (cause) { if (request === epoch) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (request === epoch) busy.value = false }
}, { immediate: true })
watch([context, flags, parameters, workshopValid, busy, error, runSelection, foundationSelection], () => {
  const current = context.value
  emit('select', current?.ready && (requiresProfile.value ? current.workshop_profile : current.purpose !== 'workshop') && workshopValid.value && (!runDescriptor.value || runSelection.value) && (!foundationDescriptor.value || foundationSelection.value) && parameters.value && !busy.value && !error.value
    ? { context_id: current.id, target_host_id: current.target_host_id, features: { ...flags.value }, parameters: { ...parameters.value },
      ...(runSelection.value ? {workshop: {...runSelection.value.workshop}, allocation: runSelection.value.allocation} : {}),
      ...(foundationSelection.value ? {foundation: {...foundationSelection.value.foundation}, allocation: foundationSelection.value.allocation} : {}) } : null)
}, { deep: true })
onBeforeUnmount(() => { epoch += 1 })
</script>

<template>
  <section class="space-y-3 rounded border border-base-300 p-3">
    <p class="text-sm">{{ t('deployment.native.workflow') }}</p>
    <p v-if="busy" role="status" class="text-sm">{{ t('deployment.native.loading') }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="reservationNotice" class="text-xs text-base-content/70">{{ reservationNotice }}</p>
    <p v-if="!busy && !error && !contexts.length" role="status" data-testid="native-context-empty" class="text-sm">{{ t('deployment.native.empty') }}</p>
    <label v-if="contexts.length" class="flex min-w-0 flex-col form-control gap-1">
      <span>{{ t('deployment.native.environment') }}</span>
      <select v-model="selected" class="select select-bordered w-full" data-testid="native-context" :disabled="busy">
        <option value="" disabled>{{ t('deployment.native.choose') }}</option>
        <option v-for="item in contexts" :key="item.id" :value="item.id" :disabled="requiresProfile ? (!item.ready || !item.workshop_profile) : item.purpose === 'workshop'">{{ item.label }}{{ !requiresProfile && item.purpose === 'workshop' ? ' — Workshop only' : requiresProfile && !item.workshop_profile ? ' — Workshop provisioning profile is not configured' : '' }}</option>
      </select>
    </label>
    <p v-if="runDescriptor && !busy && contexts.length && !contexts.some(item => item.ready && item.workshop_profile)" role="alert" class="text-sm text-warning">Workshop provisioning profile is not configured for an available environment. Prepare and register a dedicated profile before reserving participant resources. <router-link to="/settings?tab=connections#native-environments" class="link underline-offset-4">Configure a provisioning environment</router-link></p>
    <p v-if="runDescriptor && context?.execution_ready === false" role="status" class="text-sm text-warning">Infrastructure qualification is required before starting guests. You can review and reserve a draft run while its templates and network policy are prepared.</p>
    <ul v-if="context?.issues.length" class="text-sm text-error" role="alert"><li v-for="issue in context.issues" :key="issue">{{ issue }}</li></ul>
    <fieldset v-if="platform" class="min-w-0 space-y-3" :disabled="busy">
      <legend class="font-medium">{{ t('deployment.platform.title') }} — {{ platform.id }}</legend>
      <p class="text-sm">{{ platform.domain }}</p>
      <div class="flex flex-wrap gap-2">
        <button v-for="preset in platform.presets" :key="preset.id" type="button"
          class="btn btn-outline btn-sm" :data-testid="`platform-preset-${preset.id}`"
          @click="flags = { ...preset.features }">{{ t(`deployment.platform.${preset.id}`) }}</button>
      </div>
      <p class="text-xs">{{ t('deployment.platform.reserved') }}</p>
      <p class="text-sm">{{ t('deployment.platform.unavailable') }}:
        <span v-for="(reason, name) in platform.unavailable" :key="name" class="mr-3">{{ name }} ({{ reason }})</span>
      </p>
      <label v-for="field in platform.parameters" :key="field.name" class="flex min-w-0 flex-col form-control gap-1">
        <span class="text-sm">{{ field.label }}{{ field.required ? ' *' : '' }}</span>
        <input v-model="setup[field.name]" class="input input-bordered w-full"
          :data-testid="`platform-input-${field.name}`" :required="field.required" autocomplete="off" />
      </label>
      <p v-if="!parameters" role="status" class="text-sm">{{ t('deployment.platform.setupRequired') }}</p>
    </fieldset>
    <fieldset v-if="features.length" class="min-w-0 space-y-2" :disabled="busy">
      <legend class="font-medium mb-2">{{ t('deployment.native.features') }}</legend>
      <label v-for="feature in features" :key="feature.id" class="flex gap-3 items-start">
        <input v-model="flags[feature.id]" type="checkbox" class="checkbox checkbox-sm" :data-testid="`native-feature-${feature.id}`" />
        <span class="text-sm"><span class="block">{{ feature.label || feature.id }}</span><span class="block text-xs text-base-content/70">{{ feature.description }}</span></span>
      </label>
    </fieldset>
    <fieldset v-if="isWorkshop" class="min-w-0 space-y-3 rounded border border-base-300 p-3" data-testid="workshop-setup" :disabled="busy">
      <legend class="font-medium">Workshop setup</legend>
      <label class="flex min-w-0 flex-col form-control gap-1"><span class="text-sm">Participant environments to deploy</span>
        <select v-model.number="workshopSeat" name="workshop-seat" class="select select-bordered w-full" data-testid="workshop-seat">
          <option :value="0">All selected participants ({{ flags.EXTRA_SEATS ? 10 : 5 }})</option>
          <option v-for="seat in 10" :key="seat" :value="seat" :disabled="seat > (flags.EXTRA_SEATS ? 10 : 5)">user{{ String(seat).padStart(2, '0') }} only</option>
        </select>
      </label>
      <p v-if="workshopSeat > (flags.EXTRA_SEATS ? 10 : 5)" role="alert" class="text-sm text-error">Enable ten participants or choose a participant from user01–user05.</p>
      <p class="text-sm text-base-content/70">Confirm the platform qualification before deployment. These checks do not create the parent bridges or templates.</p>
      <label v-for="check in workshopChecks" :key="check.id" class="flex items-start gap-2 text-sm">
        <input v-model="workshopAccepted[check.id]" type="checkbox" :name="`workshop-accept-${check.id.toLowerCase()}`" class="checkbox checkbox-sm" :data-testid="`workshop-accept-${check.id}`" />{{ check.label }}
      </label>
    </fieldset>
    <WorkshopRunSetup v-if="runDescriptor" :key="`${projectId}:${revision}:${path}:${componentId || ''}`" :project-id="projectId" :revision="revision" :path="path" :component-id="componentId" :target-host-id="context?.target_host_id || ''" :profile="context?.workshop_profile" :min-seats="runDescriptor.min_seats" :max-seats="runDescriptor.max_seats" @select="runSelection = $event" />
    <FoundationSetup v-if="foundationDescriptor" :key="`${projectId}:${revision}:${path}:${componentId || ''}`" :project-id="projectId" :revision="revision" :path="path" :component-id="componentId" :context-id="context?.id || ''" :target-host-id="context?.target_host_id || ''" :profile="context?.workshop_profile" @select="foundationSelection = $event" />
    <WorkshopTemplatePreview v-if="runDescriptor && !runSelection" :min-seats="runDescriptor.min_seats" :max-seats="runDescriptor.max_seats" />
    <NativeScenarioPreview v-else-if="foundationSelection?.topology || runSelection?.topology || topology" :topology="foundationSelection?.topology || runSelection?.topology || topology!" :features="features" :selected-features="flags" :selected-seat="isWorkshop ? workshopSeat : 0" compact />
    <details v-if="!foundationDescriptor">
      <summary class="cursor-pointer text-sm">{{ t('deployment.native.parameters') }}</summary>
      <label class="block text-sm mt-2"><span>{{ t('deployment.native.parametersHint') }}</span>
        <textarea v-model="parametersText" class="textarea textarea-bordered font-mono w-full mt-2" rows="3" spellcheck="false" data-testid="native-parameters" :disabled="busy" />
      </label>
      <p v-if="!parameters" role="alert" class="text-sm text-error">{{ t('deployment.native.invalidParameters') }}</p>
    </details>
    <p class="text-xs text-base-content/70">{{ t('deployment.native.credentials') }}</p>
  </section>
</template>

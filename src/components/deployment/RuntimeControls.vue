<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { ensureNamespaces } from '@/i18n'
import RuntimeReport from './RuntimeReport.vue'

const props = defineProps({ deploymentId: { type: String, required: true }, disabled: Boolean })
const emit = defineEmits(['started'])
const { t } = useI18n()
const backend = useBackendApiStore()
const state = ref(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const reviewed = ref(null)
const sharedAck = ref(false)
const queued = ref('')
const preview = ref(null)
const planning = ref(false)
const showReport = ref(false)
const reviewedKinds = ['host_firewall', 'sdn_network', 'firewall_alias', 'firewall_rule']
let version = 0
const busy = computed(() => loading.value || submitting.value || planning.value || props.disabled || state.value?.permissions?.operate === false)
const flag = value => t(value === true ? 'runtime.enabled' : value === false ? 'runtime.disabled' : 'runtime.unknown')
const supported = kind => state.value?.runtime?.available === true && state.value.runtime.operations?.includes(kind)
const canScenario = computed(() => supported('scenario_firewall') && state.value.vms.some(vm => vm.status === 'owned')
  && state.value.vms.every(vm => ['owned', 'missing'].includes(vm.status)))
const canNat = network => supported('sdn_snat') && state.value.sdn.pending_changes === false && !state.value.sdn.errors?.length
  && network.identity_matches && network.active && typeof network.configured_snat === 'boolean'
const needsSharedAck = computed(() => ['sdn_snat', ...reviewedKinds].includes(reviewed.value?.kind))
const canApply = computed(() => reviewed.value && !busy.value && (!needsSharedAck.value || sharedAck.value)
  && (!reviewedKinds.includes(reviewed.value.kind) || preview.value))
const operationTitle = computed(() => {
  if (!reviewed.value) return ''
  const request = reviewed.value
  if (request.kind === 'runtime_observe') return t('runtime.observe')
  if (request.kind === 'sdn_network') return t(`runtime.network.${request.action}`, { name: request.vnet })
  if (['firewall_alias', 'firewall_rule'].includes(request.kind)) return t('runtime.policy.reviewTitle', {
    action: t(`runtime.policy.actions.${request.action}`), scope: `${t(`runtime.report.scopes.${request.scope}`)} ${request.vm_id || ''}`,
  })
  const action = t(request.enabled ? 'runtime.enable' : 'runtime.disable')
  if (request.kind === 'host_firewall') return t('runtime.reviewHost', { action, name: state.value.node_name })
  if (request.kind === 'sdn_snat') return t('runtime.reviewNat', { action, name: request.vnet })
  return t('runtime.reviewFirewall', { action, name: request.kind === 'scenario_firewall' ? t('runtime.scenarioGuests')
    : state.value.vms.find(vm => vm.vm_id === request.vm_id)?.name || request.vm_id })
})

async function reload() {
  const current = ++version
  reviewed.value = null
  preview.value = null
  planning.value = false
  sharedAck.value = false
  error.value = ''
  loading.value = true
  try {
    const result = await backendRequest(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/runtime`)
    if (current !== version) return
    if (!Array.isArray(result?.firewall?.errors) || !Array.isArray(result?.sdn?.errors)
      || !Array.isArray(result.vms) || !Array.isArray(result.networks)) throw new Error(t('runtime.invalidState'))
    state.value = result
  } catch (cause) {
    if (current === version) { state.value = null; error.value = cause.message }
  } finally {
    if (current === version) loading.value = false
  }
}

async function review(request) {
  if (busy.value) return
  reviewed.value = request
  preview.value = null
  sharedAck.value = false
  error.value = ''
  if (!reviewedKinds.includes(request.kind)) return
  const current = version
  planning.value = true
  try {
    const result = await backendRequest(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/operations/plan`, {
      method: 'POST', body: JSON.stringify({ ...request, acknowledge_shared_scope: true }),
    })
    if (current !== version) return
    if (!/^[a-f0-9]{64}$/.test(result?.review_fingerprint) || !result.plan || !result.target_host_id
      || result.target_identity?.node_name !== state.value.node_name) throw new Error(t('runtime.invalidState'))
    preview.value = result
  } catch (cause) {
    if (current === version) { error.value = cause.message; reviewed.value = null }
  } finally { if (current === version) planning.value = false }
}

async function apply() {
  if (!canApply.value) return
  const current = version
  const request = { ...reviewed.value, ...(needsSharedAck.value ? { acknowledge_shared_scope: true } : {}),
    ...(preview.value ? { review_fingerprint: preview.value.review_fingerprint } : {}) }
  submitting.value = true
  error.value = ''
  try {
    const attempt = await backendRequest(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/operations`, { method: 'POST', body: JSON.stringify(request) })
    if (current !== version) return
    if (attempt.state === 'failed') throw new Error(attempt.sub_reason || t('runtime.failed'))
    queued.value = attempt.id
    reviewed.value = null
    emit('started', attempt)
  } catch (cause) {
    if (current === version) error.value = cause.message
  } finally {
    if (current === version) submitting.value = false
  }
}

watch([() => props.deploymentId, getBackendScope, () => backend.token], () => {
  state.value = null
  queued.value = ''
  showReport.value = false
  submitting.value = false
  void reload()
}, { immediate: true })
watch(() => props.disabled, (disabled, wasDisabled) => { if (wasDisabled && !disabled) void reload() })
onMounted(() => ensureNamespaces(['runtime']))
onBeforeUnmount(() => { version += 1 })
</script>

<template>
  <section class="rounded-xl border border-base-300 p-4 mb-4 space-y-4" data-testid="runtime-controls">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div><h2 class="font-semibold">{{ t('runtime.title') }}</h2><p class="text-sm text-base-content/70 mt-1">{{ t('runtime.description') }}</p></div>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="loading || submitting" @click="reload">{{ t(loading ? 'runtime.loading' : 'runtime.refresh') }}</button>
    </header>
    <p v-if="error" role="alert" class="alert alert-error text-sm break-words">{{ error }}</p>
    <p v-if="queued" role="status" class="text-sm">{{ t('runtime.queued', { id: queued }) }}</p>
    <template v-if="state">
      <div class="flex flex-wrap gap-3 text-sm"><span>{{ t('runtime.datacenter') }}: {{ flag(state.firewall.datacenter_enabled) }}</span><span>{{ t('runtime.node', { name: state.node_name }) }}: {{ flag(state.firewall.node_enabled) }}</span></div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-outline" data-testid="runtime-report-open" @click="showReport = !showReport">{{ t('runtime.report.title') }}</button>
        <button v-if="supported('runtime_observe')" type="button" class="btn btn-sm btn-outline" :disabled="busy" @click="review({ kind: 'runtime_observe' })">{{ t('runtime.observe') }}</button>
      </div>
      <RuntimeReport v-if="showReport" :deployment-id="deploymentId" :can-admin="state.permissions?.admin && supported('firewall_rule') && supported('firewall_alias')" :disabled="busy" @review="review" />
      <div v-if="state.permissions?.admin && supported('host_firewall')" class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-outline" data-testid="runtime-host-enable" :disabled="busy" @click="review({ kind: 'host_firewall', enabled: true })">{{ t('runtime.enableHost') }}</button>
        <button type="button" class="btn btn-sm btn-outline" :disabled="busy" @click="review({ kind: 'host_firewall', enabled: false })">{{ t('runtime.disableHost') }}</button>
      </div>
      <p v-if="!state.runtime?.available" class="text-sm text-base-content border-l-2 border-warning pl-2">{{ state.runtime?.reason || t('runtime.unavailable') }}</p>
      <p v-for="message in [...state.firewall.errors, ...state.sdn.errors]" :key="message" class="text-sm text-base-content border-l-2 border-warning pl-2">{{ message }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-outline" data-testid="runtime-scenario-enable" :disabled="busy || !canScenario" @click="review({ kind: 'scenario_firewall', enabled: true })">{{ t('runtime.enableScenario') }}</button>
        <button type="button" class="btn btn-sm btn-outline" :disabled="busy || !canScenario" @click="review({ kind: 'scenario_firewall', enabled: false })">{{ t('runtime.disableScenario') }}</button>
      </div>
      <ul class="space-y-2">
        <li v-for="vm in state.vms" :key="vm.vm_id" class="rounded-lg bg-base-200/60 p-3 flex flex-wrap justify-between gap-3">
          <div class="min-w-0"><p class="text-sm font-medium break-words">{{ vm.name }} · {{ vm.vm_id }} · {{ t(`runtime.ownership.${vm.status}`) }}</p>
            <p class="text-sm">{{ t('runtime.vmFirewall') }}: {{ flag(vm.firewall_enabled) }}</p>
            <p v-for="nic in vm.nics" :key="nic.index" class="text-xs mt-1 break-words">net{{ nic.index }} · {{ nic.bridge }} · {{ flag(nic.firewall_enabled) }}</p>
            <p v-if="vm.status === 'owned' && vm.filtering_configured !== true" class="text-xs mt-1 text-base-content border-l-2 border-warning pl-2">{{ t('runtime.prerequisites') }}</p>
          </div>
          <button type="button" class="btn btn-sm btn-outline" :data-testid="`runtime-vm-${vm.vm_id}`"
            :disabled="busy || !supported('vm_firewall') || vm.status !== 'owned' || typeof vm.firewall_enabled !== 'boolean'"
            @click="review({ kind: 'vm_firewall', vm_id: vm.vm_id, enabled: !vm.firewall_enabled })">{{ t(vm.firewall_enabled ? 'runtime.disableFirewall' : 'runtime.enableFirewall') }}</button>
        </li>
      </ul>
      <div v-for="network in state.networks" :key="network.vnet" class="rounded-lg bg-base-200/60 p-3 flex flex-wrap justify-between gap-3">
        <div class="min-w-0"><p class="text-sm font-medium break-all">{{ network.vnet }} · {{ network.subnet }}</p>
          <p class="text-sm">{{ t('runtime.liveNat') }}: {{ flag(network.configured_snat) }} · {{ t('runtime.savedNat') }}: {{ flag(network.manifest_snat) }}</p>
          <p v-if="!network.live_forwarding_verified" class="text-xs mt-1 text-base-content/70">{{ t('runtime.forwardingUnknown') }}</p>
        </div>
        <button type="button" class="btn btn-sm btn-outline" :data-testid="`runtime-nat-${network.vnet}`" :disabled="busy || !canNat(network)"
          @click="review({ kind: 'sdn_snat', vnet: network.vnet, enabled: !network.configured_snat })">{{ t(network.configured_snat ? 'runtime.disableNat' : 'runtime.enableNat') }}</button>
        <div v-if="state.permissions?.admin && supported('sdn_network')" class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm btn-outline" :data-testid="`runtime-network-create-${network.vnet}`" :disabled="busy || network.identity_matches"
            @click="review({ kind: 'sdn_network', action: 'create', vnet: network.vnet })">{{ t('runtime.network.create', { name: network.vnet }) }}</button>
          <button type="button" class="btn btn-sm btn-outline" :data-testid="`runtime-network-delete-${network.vnet}`" :disabled="busy || !network.identity_matches"
            @click="review({ kind: 'sdn_network', action: 'delete', vnet: network.vnet })">{{ t('runtime.network.delete', { name: network.vnet }) }}</button>
        </div>
      </div>
      <form v-if="reviewed" class="border border-primary/30 rounded-lg p-4 space-y-3" @submit.prevent="apply">
        <h3 class="font-semibold">{{ operationTitle }}</h3>
        <p class="text-sm">{{ t(['firewall_alias', 'firewall_rule'].includes(reviewed.kind) ? 'runtime.policy.scopeHint' : reviewed.kind === 'sdn_network' ? 'runtime.network.scope' : reviewed.kind === 'runtime_observe' ? 'runtime.observeScope' : reviewed.kind === 'host_firewall' ? 'runtime.hostScope' : reviewed.kind === 'sdn_snat' ? (state.runtime?.contract === 'native-sdn-20260921' ? 'runtime.nativeNatScope' : 'runtime.natScope') : 'runtime.firewallScope') }}</p>
        <p v-if="planning" role="status" class="text-sm">{{ t('runtime.loading') }}</p>
        <p v-if="preview" class="text-xs break-all">{{ preview.target_host_id }} · {{ preview.target_identity.node_name }} · {{ preview.project_sha }}</p>
        <p v-if="preview?.plan.network" class="text-sm break-words">{{ preview.plan.network.zone }} · {{ preview.plan.network.vnet }} · {{ preview.plan.network.subnet }} · {{ preview.plan.network.gateway || '—' }}</p>
        <p v-if="reviewed.rule" class="text-sm break-words">{{ reviewed.rule.direction }} · {{ reviewed.rule.action }} · {{ reviewed.rule.protocol }} · {{ reviewed.rule.destination_port }} · {{ reviewed.rule.source || '—' }} → {{ reviewed.rule.destination || '—' }} · {{ flag(reviewed.rule.enabled) }}</p>
        <p v-if="reviewed.name" class="text-sm break-words">{{ reviewed.name }} · {{ reviewed.cidr }} <span v-if="reviewed.new_name">→ {{ reviewed.new_name }}</span></p>
        <p v-if="reviewed.position !== undefined" class="text-sm">#{{ reviewed.position }} <span v-if="reviewed.move_to !== undefined">→ #{{ reviewed.move_to }}</span></p>
        <label v-if="needsSharedAck" class="flex items-start gap-2 text-sm"><input v-model="sharedAck" type="checkbox" class="checkbox checkbox-sm" data-testid="runtime-shared-ack" />{{ t(['firewall_alias', 'firewall_rule'].includes(reviewed.kind) ? 'runtime.policy.ack' : reviewed.kind === 'host_firewall' ? 'runtime.hostAck' : 'runtime.sharedAck') }}</label>
        <div class="flex flex-wrap gap-2"><button type="submit" class="btn btn-sm btn-primary" data-testid="runtime-apply" :disabled="!canApply">{{ t(reviewed.kind === 'runtime_observe' ? 'runtime.observe' : 'runtime.apply') }}</button><button type="button" class="btn btn-sm btn-ghost" :disabled="submitting || planning" @click="reviewed = null">{{ t('runtime.cancel') }}</button></div>
      </form>
    </template>
  </section>
</template>

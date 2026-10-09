<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import RuntimePolicyEditor from './RuntimePolicyEditor.vue'

const props = defineProps({ deploymentId: { type: String, required: true }, canAdmin: Boolean, disabled: Boolean,
  refreshVersion: { type: Number, default: 0 } })
const emit = defineEmits(['review'])
const { t } = useI18n()
const backend = useBackendApiStore()
const report = ref(null)
const error = ref('')
const loading = ref(false)
let version = 0
const truth = value => t(value === true ? 'runtime.report.yes' : value === false ? 'runtime.report.no' : 'runtime.unknown')
const flag = value => t(value === true ? 'runtime.enabled' : value === false ? 'runtime.disabled' : 'runtime.unknown')
async function reload() {
  const current = ++version
  loading.value = true
  error.value = ''
  try {
    const value = await backendRequest(`/v1/deployments/${encodeURIComponent(props.deploymentId)}/runtime-report`)
    if (current !== version) return
    if (value?.version !== 1 || !Array.isArray(value.chains) || !Array.isArray(value.cards)
      || !Array.isArray(value.live_nat?.rules)) throw new Error(t('runtime.invalidState'))
    report.value = value
  } catch (cause) {
    if (current === version) error.value = cause.message
  } finally { if (current === version) loading.value = false }
}
watch([() => props.deploymentId, getBackendScope, () => backend.token], () => { report.value = null; void reload() }, { immediate: true })
watch(() => props.refreshVersion, () => { void reload() })
onBeforeUnmount(() => { version += 1 })
</script>

<template>
  <section class="border border-base-300 rounded-lg p-3 space-y-3" data-testid="runtime-report">
    <div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">{{ t('runtime.report.title') }}</h3>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="loading" @click="reload">{{ t(loading ? 'runtime.loading' : 'runtime.refresh') }}</button></div>
    <p v-if="error" role="alert" class="text-error break-words">{{ error }}</p>
    <template v-if="report">
      <p class="text-xs break-words">{{ t('runtime.report.observed') }}: {{ report.observed_at }}</p>
      <p v-if="report.partial" class="text-sm border-l-2 border-warning pl-2">{{ t('runtime.report.partial') }}</p>
      <p class="text-sm">{{ t('runtime.report.traffic') }}</p>
      <p v-if="report.switches" class="text-xs">{{ t('runtime.report.scopes.datacenter') }}: {{ flag(report.switches.datacenter_enabled) }} · {{ t('runtime.report.scopes.node') }}: {{ flag(report.switches.node_enabled) }}</p>
      <template v-if="report.sdn">
        <p class="text-xs">{{ t('runtime.report.pending') }}: {{ truth(report.sdn.pending_changes) }}</p>
        <p v-for="detail in report.sdn.errors" :key="detail" class="text-sm border-l-2 border-warning pl-2">{{ detail }}</p>
      </template>
      <div v-for="network in report.networks" :key="network.vnet" :data-testid="`reported-network-${network.vnet}`" class="text-xs break-words rounded bg-base-200 p-2 space-y-1">
        <p>{{ network.zone }} / {{ network.vnet }} · {{ network.subnet }} · {{ network.gateway || '—' }}</p>
        <p>{{ t('runtime.report.identity') }}: {{ truth(network.identity_matches) }} · {{ t('runtime.report.active') }}: {{ truth(network.active) }}</p>
        <p>{{ t('runtime.report.declaredNat') }}: {{ flag(network.manifest_snat) }} · {{ t('runtime.report.configuredNat') }}: {{ flag(network.configured_snat) }}</p>
      </div>
      <div v-for="chain in report.chains" :key="`${chain.scope}-${chain.vm_id}`" class="space-y-2">
        <h4 class="text-sm font-semibold">{{ t(`runtime.report.scopes.${chain.scope}`) }} {{ chain.vm_id }}</h4>
        <p v-if="!chain.available" class="text-sm border-l-2 border-warning pl-2">{{ chain.error || t('runtime.unknown') }}</p>
        <template v-else>
          <p v-if="!chain.rules.length" class="text-sm">{{ t('runtime.report.emptyRules') }}</p>
          <ol class="space-y-1 text-xs">
            <li v-for="rule in chain.rules" :key="rule.position" class="break-words rounded bg-base-200 p-2">
              #{{ rule.position }} · {{ flag(rule.enabled) }} · {{ rule.direction }} · {{ rule.action }}
              · {{ rule.protocol || '—' }} · {{ rule.destination_port || '—' }}
              <span v-if="rule.source"> · {{ t('runtime.report.source') }}: {{ rule.source }}</span>
              <span v-if="rule.destination"> · {{ t('runtime.report.destination') }}: {{ rule.destination }}</span>
              <span v-if="rule.interface"> · {{ rule.interface }}</span><span v-if="rule.macro"> · {{ rule.macro }}</span>
              <span v-if="rule.comment"> · {{ rule.comment }}</span>
            </li>
          </ol>
          <p v-for="alias in chain.aliases" :key="alias.name" class="text-xs break-words">{{ t('runtime.report.alias') }} {{ alias.name }} → {{ alias.cidr }} {{ alias.comment }}</p>
        </template>
      </div>
      <div v-for="card in report.cards" :key="`${card.vm_id}-${card.index}`" class="text-xs break-words">
        {{ card.vm_id }} · net{{ card.index }} · {{ card.bridge }} · {{ t('runtime.report.configuredFiltering') }}: {{ flag(card.filtering_configured) }}
        <p v-for="reason in card.reasons" :key="reason">{{ t(`runtime.report.reasons.${reason}`) }}</p>
      </div>
      <h4 class="text-sm font-semibold">{{ t('runtime.report.liveNat') }}</h4>
      <p v-if="!report.live_nat.available" class="text-sm">{{ t('runtime.report.natUnknown') }}</p>
      <template v-else>
        <p class="text-xs break-words">{{ report.live_nat.observed_at }} · {{ report.live_nat.attempt_id }} · {{ t('runtime.report.historical') }}</p>
        <p v-if="!report.live_nat.rules.length" class="text-sm">{{ t('runtime.report.noNat') }}</p>
        <p v-for="(rule, index) in report.live_nat.rules" :key="index" class="text-xs break-words">
          {{ rule.snat_source }} → {{ rule.snat_out_iface }} · {{ rule.snat_target }} × {{ rule.snat_count }}
        </p>
      </template>
      <RuntimePolicyEditor v-if="canAdmin" :deployment-id="deploymentId" :chains="report.chains" :disabled="disabled || loading || !!error" @review="emit('review', $event)" />
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import { useCatalog } from '@/composables/useCatalog'
import { useCatalogSources } from '@/composables/useCatalogSources'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { bundleDefaults, bundleParameters, managedBundleParameter, requiredBundleParameter, bundleChoices } from '@/services/bundleParameters'
import { useInventoryStore } from '@/stores/inventoryStore'

const props = defineProps({ open: Boolean, vms: { type: Array, default: () => [] } })
const emit = defineEmits(['selected', 'close'])
const { t } = useI18n()
const catalog = useCatalog()
const sources = useCatalogSources()
const inventory = useInventoryStore()
const entries = ref([])
const query = ref('')
const sourceFilter = ref('')
const selected = ref(null)
const resolution = ref(null)
const values = ref({})
const target = ref('')
const busy = ref(false)
const error = ref('')
const focusReady = ref(false)
const heading = ref(null)
let version = 0
const current = stamp => props.open && stamp === version
const sourceIds = computed(() => [...new Set(entries.value.map(entry => entry.source_id))])
const visibleEntries = computed(() => entries.value.filter(entry =>
  (!sourceFilter.value || entry.source_id === sourceFilter.value)
  && [entry.name, entry.path, entry.description, ...(entry.tags || [])].some(value => String(value || '').toLowerCase().includes(query.value.toLowerCase())),
))
const editable = computed(() => (resolution.value?.params || []).filter(param => !managedBundleParameter(param, resolution.value.target_vars)))
const vaultParams = computed(() => (resolution.value?.params || []).filter(param => param.from_vault))
const validTarget = computed(() => props.vms.some(vm => vm.node_id === target.value))

function booleanChoices(param) {
  const choices = bundleChoices(param)
  return [true, false].filter(value => !choices.length || choices.includes(param.bool_style === 'yesno' ? (value ? 'YES' : 'NO') : value))
}

async function reload() {
  const stamp = ++version
  busy.value = true
  error.value = ''
  resolution.value = null
  try {
    const loaded = await catalog.listEntries({ kind: 'bundle', limit: 100 })
    if (!current(stamp)) return
    entries.value = loaded
    error.value = catalog.error.value || ''
  } catch (cause) { if (current(stamp)) error.value = cause.message || String(cause) }
  finally { if (current(stamp)) busy.value = false }
}

async function connectDefault() {
  const stamp = ++version
  busy.value = true
  error.value = ''
  resolution.value = null
  try {
    const source = await sources.connectDefault('bundles')
    if (!current(stamp)) return
    await sources.refreshSource(source.id)
    if (current(stamp)) await reload()
  } catch (cause) { if (current(stamp)) error.value = cause.message || String(cause) }
  finally { if (current(stamp)) busy.value = false }
}

async function choose(entry) {
  const stamp = ++version
  busy.value = true
  error.value = ''
  selected.value = null
  resolution.value = null
  try {
    const detail = await catalog.getEntry(entry.source_id, entry.path)
    if (!current(stamp)) return
    if (!detail || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(detail.sha || '')) throw new Error(t('bundles.missingRevision'))
    const proof = await backendRequest(`/v1/catalog/sources/${encodeURIComponent(entry.source_id)}/bundles/resolve`, {
      method: 'POST', body: JSON.stringify({ path: entry.path, sha: detail.sha, target_kind: 'VM' }),
    })
    if (!current(stamp)) return
    const expectedPath = entry.path.replace(/^bundles\//, '')
    const singleVmScope = proof.bundle_kind === 'VM' || (proof.bundle_kind === 'GROUP' && proof.target_kind === 'VM'
      && Array.isArray(proof.target_vars) && proof.target_vars.includes('target_group'))
    if (proof.source_id !== entry.source_id || proof.source_sha !== detail.sha || proof.path !== entry.path
      || !singleVmScope || proof.proof_kind !== 'content_match'
      || !['main.yml', 'main.yaml'].some(name => proof.entrypoint === `${expectedPath}/${name}`)
      || !proof.runtime?.fingerprint || !proof.runtime?.proof || !Array.isArray(proof.params) || !Array.isArray(proof.target_vars)) {
      throw new Error(t('bundles.invalidProof'))
    }
    values.value = bundleDefaults(proof.params, proof.target_vars)
    selected.value = detail
    resolution.value = proof
  } catch (cause) { if (current(stamp)) error.value = cause.message || String(cause) }
  finally { if (current(stamp)) busy.value = false }
}

function attach() {
  if (!resolution.value || !validTarget.value || busy.value) return
  error.value = ''
  try {
    const vars = bundleParameters(resolution.value.params, values.value, resolution.value.target_vars)
    emit('selected', { id: crypto.randomUUID(), kind: 'bundle', target_node: target.value,
      path: resolution.value.entrypoint, vars, resolution: JSON.parse(JSON.stringify(resolution.value)) })
  } catch (cause) { error.value = cause.message || String(cause) }
}

watch([() => props.open, getBackendScope], async ([open]) => {
  version += 1
  focusReady.value = false
  busy.value = false
  resolution.value = null
  selected.value = null
  entries.value = []
  error.value = ''
  query.value = ''
  sourceFilter.value = ''
  target.value = props.vms[0]?.node_id || ''
  if (!open) return
  void ensureNamespaces(['bundles'])
  void reload()
  await nextTick()
  if (props.open) { focusReady.value = true; heading.value?.focus() }
}, { immediate: true })
onBeforeUnmount(() => { version += 1 })
</script>

<template>
  <Teleport to="body">
    <FocusTrap v-if="open" :active="focusReady" :initial-focus="() => heading" :fallback-focus="() => heading" :escape-deactivates="false" :return-focus-on-deactivate="true">
      <div class="modal modal-open z-[1050] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="bundle-library-title" @keydown.esc.stop.prevent="emit('close')">
        <section class="modal-box w-full max-w-5xl max-h-[92vh] overflow-y-auto space-y-4">
          <header class="flex items-start justify-between gap-3">
            <div>
              <h2 id="bundle-library-title" ref="heading" tabindex="-1" class="text-xl font-bold">{{ t('bundles.title') }}</h2>
              <p class="text-sm text-base-content/70 mt-1">{{ t('bundles.description') }}</p>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">{{ t('bundles.close') }}</button>
          </header>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline btn-sm" data-testid="bundle-default" :disabled="busy" @click="connectDefault">{{ t('bundles.connectDefault') }}</button>
            <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="reload">{{ t('bundles.reload') }}</button>
          </div>
          <p v-if="busy" role="status" class="text-sm">{{ t('bundles.loading') }}</p>
          <p v-if="error" role="alert" class="text-error text-sm break-words">{{ error }}</p>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-3 min-w-0">
              <label class="form-control gap-1"><span>{{ t('bundles.search') }}</span><input v-model="query" type="search" class="input input-bordered w-full" data-testid="bundle-search" /></label>
              <label class="form-control gap-1"><span>{{ t('bundles.source') }}</span><select v-model="sourceFilter" class="select select-bordered w-full"><option value="">{{ t('bundles.allSources') }}</option><option v-for="id in sourceIds" :key="id" :value="id">{{ inventory.getSource(id)?.name || id }}</option></select></label>
              <ul class="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
                <li v-for="entry in visibleEntries" :key="`${entry.source_id}:${entry.path}`">
                  <button type="button" class="w-full rounded-lg border p-3 text-left hover:bg-base-200 focus-visible:outline focus-visible:outline-primary" data-testid="bundle-choice"
                    :class="selected?.source_id === entry.source_id && selected?.path === entry.path ? 'border-primary bg-primary/5' : 'border-base-300'" :disabled="busy" @click="choose(entry)">
                    <span class="font-medium block break-words">{{ entry.name }}</span>
                    <span class="text-xs text-base-content/70 block break-words">{{ entry.description || entry.path }}</span>
                    <span v-for="tag in entry.tags || []" :key="tag" class="badge badge-sm badge-outline mt-2 mr-1">{{ tag }}</span>
                  </button>
                </li>
              </ul>
              <p v-if="!busy && !visibleEntries.length" class="text-sm text-base-content/70">{{ t('bundles.empty') }}</p>
            </div>
            <div v-if="resolution" class="space-y-3 min-w-0">
              <h3 class="font-semibold">{{ selected.name }}</h3>
              <p class="text-success text-sm">{{ t('bundles.verified') }}</p>
              <p v-if="resolution.bundle_kind === 'GROUP'" class="text-sm">{{ t('bundles.groupBound') }}</p>
              <p v-if="resolution.entrypoint.startsWith('firewall/in_vm/os_firewall.baseline.')" class="text-sm font-medium" data-testid="bundle-firewall-reset">{{ t('bundles.firewallReset') }}</p>
              <p class="font-mono text-xs break-all">{{ resolution.source_sha }}</p>
              <details v-if="resolution.runtime.dependencies?.length" class="rounded border border-base-300 p-2 text-xs">
                <summary class="cursor-pointer font-medium">{{ t('bundles.dependencies') }}</summary>
                <p class="mt-2 text-base-content/70">{{ t('bundles.dependenciesHint') }}</p>
                <ul class="mt-2 space-y-2"><li v-for="dependency in resolution.runtime.dependencies" :key="dependency.name"><span class="block font-medium">{{ dependency.name }}</span><code class="break-all">{{ dependency.revision || dependency.sha256 }}</code></li></ul>
              </details>
              <label class="form-control gap-1"><span>{{ t('bundles.target') }}</span><select v-model="target" class="select select-bordered w-full" data-testid="bundle-target"><option value="" disabled>{{ t('bundles.chooseTarget') }}</option><option v-for="vm in vms" :key="vm.node_id" :value="vm.node_id">{{ vm.vm_name || vm.node_id }}</option></select></label>
              <p v-if="!vms.length" class="text-warning text-sm">{{ t('bundles.noVms') }}</p>
              <p class="text-xs text-base-content/70">{{ t('bundles.targetManaged') }}</p>
              <div v-for="param in editable" :key="param.name" class="form-control gap-1">
                <label :for="`bundle-param-${param.name}`" class="text-sm font-medium">{{ param.name }}<span v-if="requiredBundleParameter(param)" class="text-error"> *</span></label>
                <select v-if="param.type === 'bool'" :id="`bundle-param-${param.name}`" v-model="values[param.name]" class="select select-bordered w-full" :data-testid="`bundle-param-${param.name}`"><option value="">{{ t('bundles.inherit') }}</option><option v-for="value in booleanChoices(param)" :key="String(value)" :value="value">{{ t(value ? 'bundles.enabled' : 'bundles.disabled') }}</option></select>
                <select v-else-if="bundleChoices(param).length" :id="`bundle-param-${param.name}`" v-model="values[param.name]" class="select select-bordered w-full" :data-testid="`bundle-param-${param.name}`"><option value="">{{ t('bundles.inherit') }}</option><option v-for="value in bundleChoices(param)" :key="JSON.stringify(value)" :value="value">{{ value }}</option></select>
                <textarea v-else-if="['list', 'dict'].includes(param.type)" :id="`bundle-param-${param.name}`" v-model="values[param.name]" class="textarea textarea-bordered font-mono w-full" :data-testid="`bundle-param-${param.name}`" :placeholder="param.type === 'dict' ? '{}' : '[]'" spellcheck="false" />
                <input v-else :id="`bundle-param-${param.name}`" v-model="values[param.name]" :type="param.type === 'int' ? 'number' : 'text'" :step="param.type === 'int' ? 1 : undefined" class="input input-bordered w-full" :data-testid="`bundle-param-${param.name}`" />
                <p v-if="param.description" class="text-xs text-base-content/70">{{ param.description }}</p>
              </div>
              <p v-if="vaultParams.length" class="text-sm text-base-content/70">{{ t('bundles.vaultManaged', { names: vaultParams.map(param => param.name).join(', ') }) }}</p>
              <button type="button" class="btn btn-primary w-full" data-testid="bundle-attach" :disabled="busy || !validTarget" @click="attach">{{ t('bundles.attach') }}</button>
            </div>
            <p v-else class="text-sm text-base-content/70">{{ t('bundles.selectHint') }}</p>
          </div>
        </section>
        <div class="modal-backdrop" aria-hidden="true" @click="emit('close')" />
      </div>
    </FocusTrap>
  </Teleport>
</template>

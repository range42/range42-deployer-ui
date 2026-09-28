<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

const props = defineProps<{ projectId: string; revision: string; path: string }>()
const emit = defineEmits<{ select: [selection: null | { context_id: string; target_host_id: string; features: Record<string, boolean>; parameters: Record<string, string | number | boolean> }] }>()
const { t } = useI18n()
const backend = useBackendApiStore()
type Context = { id: string; label: string; target_host_id: string; ready: boolean; issues: string[] }
type Feature = { id: string; label?: string; description?: string; default: boolean }
type Platform = { id: string; domain: string; profile: string; unavailable: Record<string, string>;
  presets: { id: string; features: Record<string, boolean> }[];
  parameters: { name: string; label: string; type: string; required: boolean }[] }
const platform = ref<Platform | null>(null)
const setup = ref<Record<string, string>>({})
const contexts = ref<Context[]>([])
const features = ref<Feature[]>([])
const selected = ref('')
const flags = ref<Record<string, boolean>>({})
const parametersText = ref('{}')
const busy = ref(false)
const error = ref('')
let epoch = 0
const context = computed(() => contexts.value.find(item => item.id === selected.value))
const parameters = computed(() => {
  try {
    const advanced = JSON.parse(parametersText.value)
    if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) return null
    const value = { ...advanced, ...Object.fromEntries(Object.entries(setup.value).filter(([, v]) => v.trim())) }
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
watch(() => [props.projectId, props.revision, props.path, getBackendScope(), backend.token], async () => {
  const request = ++epoch
  contexts.value = []; features.value = []; selected.value = ''; flags.value = {}; error.value = ''; busy.value = true
  platform.value = null; setup.value = {}; parametersText.value = '{}'
  emit('select', null)
  try {
    const query = new URLSearchParams({ sha: props.revision, path: props.path })
    const [environments, descriptor] = await Promise.all([
      backendRequest<{ items: Context[] }>('/v1/contexts'),
      backendRequest<{ features: Feature[]; platform?: Platform }>(`/v1/projects/${encodeURIComponent(props.projectId)}/native-scenario?${query}`),
    ])
    if (request !== epoch) return
    contexts.value = environments.items
    features.value = descriptor.features
    platform.value = descriptor.platform || null
    flags.value = Object.fromEntries(descriptor.features.map(feature => [feature.id, feature.default]))
    const ready = contexts.value.filter(item => item.ready)
    if (ready.length === 1) selected.value = ready[0]!.id
  } catch (cause) { if (request === epoch) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (request === epoch) busy.value = false }
}, { immediate: true })
watch([context, flags, parameters, busy, error], () => {
  const current = context.value
  emit('select', current?.ready && parameters.value && !busy.value && !error.value
    ? { context_id: current.id, target_host_id: current.target_host_id, features: { ...flags.value }, parameters: { ...parameters.value } } : null)
}, { deep: true })
onBeforeUnmount(() => { epoch += 1 })
</script>

<template>
  <section class="space-y-3 rounded border border-base-300 p-3">
    <p class="text-sm">{{ t('deployment.native.workflow') }}</p>
    <p v-if="busy" role="status" class="text-sm">{{ t('deployment.native.loading') }}</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="!busy && !error && !contexts.length" role="status" data-testid="native-context-empty" class="text-sm">{{ t('deployment.native.empty') }}</p>
    <label v-if="contexts.length" class="form-control gap-1">
      <span>{{ t('deployment.native.environment') }}</span>
      <select v-model="selected" class="select select-bordered w-full" data-testid="native-context" :disabled="busy">
        <option value="" disabled>{{ t('deployment.native.choose') }}</option>
        <option v-for="item in contexts" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
    </label>
    <ul v-if="context?.issues.length" class="text-sm text-error" role="alert"><li v-for="issue in context.issues" :key="issue">{{ issue }}</li></ul>
    <fieldset v-if="platform" class="space-y-3" :disabled="busy">
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
      <label v-for="field in platform.parameters" :key="field.name" class="form-control gap-1">
        <span class="text-sm">{{ field.label }}{{ field.required ? ' *' : '' }}</span>
        <input v-model="setup[field.name]" class="input input-bordered w-full"
          :data-testid="`platform-input-${field.name}`" :required="field.required" autocomplete="off" />
      </label>
      <p v-if="!parameters" role="status" class="text-sm">{{ t('deployment.platform.setupRequired') }}</p>
    </fieldset>
    <fieldset v-if="features.length" class="space-y-2" :disabled="busy">
      <legend class="font-medium mb-2">{{ t('deployment.native.features') }}</legend>
      <label v-for="feature in features" :key="feature.id" class="flex gap-3 items-start">
        <input v-model="flags[feature.id]" type="checkbox" class="checkbox checkbox-sm" :data-testid="`native-feature-${feature.id}`" />
        <span class="text-sm"><span class="block">{{ feature.label || feature.id }}</span><span class="block text-xs text-base-content/70">{{ feature.description }}</span></span>
      </label>
    </fieldset>
    <details>
      <summary class="cursor-pointer text-sm">{{ t('deployment.native.parameters') }}</summary>
      <label class="block text-sm mt-2"><span>{{ t('deployment.native.parametersHint') }}</span>
        <textarea v-model="parametersText" class="textarea textarea-bordered font-mono w-full mt-2" rows="3" spellcheck="false" data-testid="native-parameters" :disabled="busy" />
      </label>
      <p v-if="!parameters" role="alert" class="text-sm text-error">{{ t('deployment.native.invalidParameters') }}</p>
    </details>
    <p class="text-xs text-base-content/70">{{ t('deployment.native.credentials') }}</p>
  </section>
</template>

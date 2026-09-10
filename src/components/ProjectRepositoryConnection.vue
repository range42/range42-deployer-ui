<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useCatalogSources } from '@/composables/useCatalogSources'
import type { ForkPolicy, ProjectGitBinding } from '@/composables/useProjectGitSync'
import PublishRepositoryFields from '@/components/PublishRepositoryFields.vue'
import ForkDestinationField from '@/components/ForkDestinationField.vue'
import { getBackendScope } from '@/services/backendApi'

const props = defineProps<{ open: boolean; binding?: ProjectGitBinding }>()
const emit = defineEmits<{ close: []; connected: [binding: ProjectGitBinding] }>()
const { t } = useI18n()
const inventory = useInventoryStore()
const { loadSources, rotateToken } = useCatalogSources()
const repository = ref({ source_id: '', repo_owner: '', repo_name: '', base_branch: 'main', subdir: '' })
const policy = ref<ForkPolicy>('auto')
const password = ref('')
const forkOwner = ref('')
const backendCredential = ref(false)
const busy = ref(false)
const error = ref('')
const closeButton = ref<HTMLButtonElement | null>(null)
const focusReady = ref(false)
let opener: HTMLElement | null = null
const selectedSource = computed(() => inventory.sources.find(source => source.id === repository.value.source_id))
watch(() => JSON.stringify([selectedSource.value?.id, selectedSource.value?.provider,
  selectedSource.value?.base_url, selectedSource.value?.backend_url]), () => { password.value = '' })
watch(() => props.open, async open => {
  focusReady.value = false
  password.value = ''
  error.value = ''
  if (!open) { opener?.focus(); return }
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const binding = props.binding
  repository.value = { source_id: binding?.source_id || '', repo_owner: binding?.repo_owner || '',
    repo_name: binding?.repo_name || '', base_branch: binding?.branch || 'main', subdir: binding?.subdir || '' }
  policy.value = binding?.fork_policy || 'auto'
  forkOwner.value = binding?.fork_owner || ''
  backendCredential.value = false
  void ensureNamespaces(['publishing'])
  if (!inventory.sources.length) {
    void Promise.resolve(loadSources()).catch(cause => { error.value = cause instanceof Error ? cause.message : t('publishing.source_error') })
  }
  await nextTick()
  if (props.open) { focusReady.value = true; closeButton.value?.focus() }
}, { immediate: true })

async function connect() {
  if (busy.value) return
  error.value = ''
  try {
    const selected = selectedSource.value
    if (!selected) throw new Error(t('publishing.choose_source'))
    const source = { ...selected }
    const scope = getBackendScope()
    const forkPolicy = policy.value
    const owner = repository.value.repo_owner.trim()
    const repo = repository.value.repo_name.trim()
    const branch = repository.value.base_branch.trim()
    const subdir = repository.value.subdir.trim().replace(/\/+$/, '')
    if (!owner.split('/').every(part => /^[\w][\w.-]*$/.test(part)) || !/^[\w][\w.-]*$/.test(repo)
      || repo.endsWith('.git') || (source.provider !== 'gitlab' && owner.includes('/'))) throw new Error(t('publishing.invalid_repo'))
    if (!branch || branch.startsWith('-') || branch === '@' || branch.includes('..') || branch.includes('@{')
      || Array.from(branch).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || '~^:?*[\\'.includes(character))
      || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) throw new Error(t('publishing.invalid_branch'))
    if (subdir && (subdir.includes('\\') || Array.from(subdir).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || subdir.split('/').some(part => !part || ['.', '..', '.git'].includes(part)))) throw new Error(t('publishing.invalid_path'))
    const destination = forkPolicy === 'upstream' ? '' : forkOwner.value.trim()
    if (destination && (!destination.split('/').every(part => /^[\w][\w.-]*$/.test(part))
      || (source.provider !== 'gitlab' && destination.includes('/')))) throw new Error(t('publishing.invalid_repo'))
    const token = password.value.trim()
    if (backendCredential.value) {
      if (source.backend_url !== getBackendScope()) throw new Error(t('publishing.source_changed'))
      if (!token) throw new Error(t('publishing.enter_credential'))
      busy.value = true
      await rotateToken(source.id, token)
      const current = selectedSource.value
      if (getBackendScope() !== scope || !current
        || current.id !== source.id || current.provider !== source.provider || current.base_url !== source.base_url
        || current.backend_url !== source.backend_url) throw new Error(t('publishing.source_changed'))
    }
    if (token) inventory.setToken(source.id, token)
    password.value = ''
    const binding: ProjectGitBinding = { source_id: source.id, provider: source.provider, base_url: source.base_url,
      repo_owner: owner, repo_name: repo, branch, subdir, branch_strategy: subdir ? 'shared_repo_subdir' : 'dedicated_repo', fork_policy: forkPolicy, ...(destination ? { fork_owner: destination } : {}) }
    const old = props.binding
    if (old && ['source_id', 'provider', 'base_url', 'repo_owner', 'repo_name'].every(key => old[key as keyof ProjectGitBinding] === binding[key as keyof ProjectGitBinding])
      && (old.branch || 'main') === branch && (old.subdir || '') === subdir) {
      binding.working_branch = old.working_branch
      binding.publish_targets = old.publish_targets
      binding.publish_results = old.publish_results
    }
    emit('connected', binding)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('publishing.review_error') }
  finally { busy.value = false }
}
</script>

<template>
  <FocusTrap v-if="open" :active="focusReady" :initial-focus="() => closeButton" :fallback-focus="() => closeButton" :escape-deactivates="false">
    <div class="modal modal-open z-[1000]" role="dialog" aria-modal="true" aria-labelledby="repository-connection-title" @keydown.esc.prevent="!busy && emit('close')">
      <div class="modal-box max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div class="flex items-start justify-between gap-4">
          <h2 id="repository-connection-title" class="text-xl font-bold">{{ t('publishing.connection_title') }}</h2>
          <button ref="closeButton" type="button" class="btn btn-ghost btn-sm" @click="!busy && emit('close')">{{ t('publishing.close') }}</button>
        </div>
        <p class="text-sm text-base-content/70">{{ t('publishing.connection_hint') }}</p>
        <p v-if="!inventory.sources.length" class="text-sm">{{ t('publishing.no_sources') }} <a href="/sources" class="link">{{ t('publishing.manage_sources') }}</a></p>
        <PublishRepositoryFields v-model="repository" :sources="inventory.sources" :disabled="busy" />
        <label class="block">
          <span class="label text-sm">{{ t('publishing.fork_policy') }}</span>
          <select v-model="policy" :disabled="busy" class="select select-bordered w-full" data-testid="connection-fork-policy">
            <option value="auto">{{ t('publishing.fork_auto') }}</option>
            <option value="fork">{{ t('publishing.fork_always') }}</option>
            <option value="upstream">{{ t('publishing.fork_never') }}</option>
          </select>
        </label>
        <ForkDestinationField v-if="policy !== 'upstream'" v-model="forkOwner" :disabled="busy" />
        <label v-if="selectedSource" class="block">
          <span class="label text-sm">{{ t('publishing.credentials_title') }}</span>
          <span v-if="inventory.getToken(selectedSource.id)" class="text-success text-sm block">{{ t('publishing.credential_connected') }}</span>
          <input v-model="password" :disabled="busy" type="password" autocomplete="new-password" class="input input-bordered w-full"
            data-testid="repository-credential" :placeholder="t('publishing.credential_placeholder')" />
          <span class="text-xs text-base-content/70 block mt-2">{{ t('publishing.credentials_hint') }}</span>
        </label>
        <label v-if="selectedSource" class="flex items-start gap-2 text-sm">
          <input v-model="backendCredential" type="checkbox" class="checkbox checkbox-sm" data-testid="backend-clone-credential" :disabled="busy" />
          <span>{{ t('publishing.backend_clone_credential') }}<span class="block text-xs text-base-content/70 mt-1">{{ t('publishing.backend_clone_hint') }}</span></span>
        </label>
        <p v-if="error" role="alert" class="text-error text-sm">{{ error }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-primary" data-testid="connect-project-repository" :disabled="busy" @click="connect">{{ t('publishing.connect_repository') }}</button>
        </div>
      </div>
      <div class="modal-backdrop" aria-hidden="true" @click="!busy && emit('close')" />
    </div>
  </FocusTrap>
</template>

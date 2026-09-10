<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useCatalogSources } from '@/composables/useCatalogSources'
import type { ForkPolicy, ProjectGitBinding } from '@/composables/useProjectGitSync'
import PublishRepositoryFields from '@/components/PublishRepositoryFields.vue'

const props = defineProps<{ open: boolean; binding?: ProjectGitBinding }>()
const emit = defineEmits<{ close: []; connected: [binding: ProjectGitBinding] }>()
const { t } = useI18n()
const inventory = useInventoryStore()
const { loadSources } = useCatalogSources()
const repository = ref({ source_id: '', repo_owner: '', repo_name: '', base_branch: 'main', subdir: '' })
const policy = ref<ForkPolicy>('auto')
const password = ref('')
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
  void ensureNamespaces(['publishing'])
  if (!inventory.sources.length) {
    void Promise.resolve(loadSources()).catch(cause => { error.value = cause instanceof Error ? cause.message : t('publishing.source_error') })
  }
  await nextTick()
  if (props.open) { focusReady.value = true; closeButton.value?.focus() }
}, { immediate: true })

function connect() {
  error.value = ''
  try {
    const source = selectedSource.value
    if (!source) throw new Error(t('publishing.choose_source'))
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
    if (password.value.trim()) inventory.setToken(source.id, password.value.trim())
    password.value = ''
    const binding: ProjectGitBinding = { source_id: source.id, provider: source.provider, base_url: source.base_url,
      repo_owner: owner, repo_name: repo, branch, subdir, branch_strategy: subdir ? 'shared_repo_subdir' : 'dedicated_repo', fork_policy: policy.value }
    const old = props.binding
    if (old && ['source_id', 'provider', 'base_url', 'repo_owner', 'repo_name'].every(key => old[key as keyof ProjectGitBinding] === binding[key as keyof ProjectGitBinding])
      && (old.branch || 'main') === branch && (old.subdir || '') === subdir) {
      binding.working_branch = old.working_branch
      binding.publish_targets = old.publish_targets
    }
    emit('connected', binding)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('publishing.review_error') }
}
</script>

<template>
  <FocusTrap v-if="open" :active="focusReady" :initial-focus="() => closeButton" :fallback-focus="() => closeButton" :escape-deactivates="false">
    <div class="modal modal-open z-[1000]" role="dialog" aria-modal="true" aria-labelledby="repository-connection-title" @keydown.esc.prevent="emit('close')">
      <div class="modal-box max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div class="flex items-start justify-between gap-4">
          <h2 id="repository-connection-title" class="text-xl font-bold">{{ t('publishing.connection_title') }}</h2>
          <button ref="closeButton" type="button" class="btn btn-ghost btn-sm" @click="emit('close')">{{ t('publishing.close') }}</button>
        </div>
        <p class="text-sm text-base-content/70">{{ t('publishing.connection_hint') }}</p>
        <p v-if="!inventory.sources.length" class="text-sm">{{ t('publishing.no_sources') }} <a href="/sources" class="link">{{ t('publishing.manage_sources') }}</a></p>
        <PublishRepositoryFields v-model="repository" :sources="inventory.sources" />
        <label class="block">
          <span class="label text-sm">{{ t('publishing.fork_policy') }}</span>
          <select v-model="policy" class="select select-bordered w-full" data-testid="connection-fork-policy">
            <option value="auto">{{ t('publishing.fork_auto') }}</option>
            <option value="fork">{{ t('publishing.fork_always') }}</option>
            <option value="upstream">{{ t('publishing.fork_never') }}</option>
          </select>
        </label>
        <label v-if="selectedSource" class="block">
          <span class="label text-sm">{{ t('publishing.credentials_title') }}</span>
          <span v-if="inventory.getToken(selectedSource.id)" class="text-success text-sm block">{{ t('publishing.credential_connected') }}</span>
          <input v-model="password" type="password" autocomplete="new-password" class="input input-bordered w-full"
            data-testid="repository-credential" :placeholder="t('publishing.credential_placeholder')" />
          <span class="text-xs text-base-content/70 block mt-2">{{ t('publishing.credentials_hint') }}</span>
        </label>
        <p v-if="error" role="alert" class="text-error text-sm">{{ error }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-primary" data-testid="connect-project-repository" @click="connect">{{ t('publishing.connect_repository') }}</button>
        </div>
      </div>
      <div class="modal-backdrop" aria-hidden="true" @click="emit('close')" />
    </div>
  </FocusTrap>
</template>

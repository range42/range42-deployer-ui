<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useCatalogSources } from '@/composables/useCatalogSources'
import { getBackendScope } from '@/services/backendApi'
import { loadGitProject, prepareGitProjectImport, validateProjectBinding } from '@/services/gitProjectOpen'
import { fileBytes, isBinaryFile } from '@/services/projectFiles'
import PublishRepositoryFields from '@/components/PublishRepositoryFields.vue'
import ForkDestinationField from '@/components/ForkDestinationField.vue'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close', 'opened'])
const { t } = useI18n()
const inventory = useInventoryStore()
const projects = useProjectStore()
const { loadSources } = useCatalogSources()
const repository = ref({ source_id: '', repo_owner: '', repo_name: '', base_branch: 'main', subdir: '' })
const password = ref('')
const forkOwner = ref('')
const preview = ref(null)
const filesOnly = ref(false)
const busy = ref(false)
const error = ref('')
const heading = ref(null)
const focusReady = ref(false)
let request = 0
let reviewedConnection = null
const source = computed(() => inventory.sources.find(item => item.id === repository.value.source_id))
const sourceIdentity = computed(() => JSON.stringify([source.value?.id, source.value?.provider, source.value?.base_url,
  source.value?.backend_url, getBackendScope()]))
const reviewedFiles = computed(() => Object.entries(preview.value?.files || {}).map(([path, content]) => ({
  path, binary: isBinaryFile(content), bytes: fileBytes(content).length,
})))
watch(sourceIdentity, () => {
  password.value = ''
  reviewedConnection = null
  if (busy.value || preview.value) {
    request += 1
    busy.value = false
    preview.value = null
    error.value = t('reopening.source_changed')
  }
})
watch(() => props.open, async open => {
  request += 1
  focusReady.value = false
  password.value = ''
  reviewedConnection = null
  preview.value = null
  error.value = ''
  busy.value = false
  if (!open) return
  await ensureNamespaces(['publishing', 'reopening'])
  if (!inventory.sources.length) void Promise.resolve(loadSources()).catch(cause => { error.value = cause.message })
  await nextTick()
  if (props.open) { focusReady.value = true; heading.value?.focus() }
}, { immediate: true })
onBeforeUnmount(() => { request += 1; reviewedConnection = null; password.value = '' })

async function review() {
  if (busy.value) return
  const current = ++request
  error.value = ''
  try {
    if (!source.value) throw new Error(t('publishing.choose_source'))
    const selected = source.value
    const identity = sourceIdentity.value
    const branch = repository.value.base_branch.trim()
    if (!branch) throw new Error(t('publishing.invalid_branch'))
    const subdir = repository.value.subdir.trim().replace(/\/+$/, '')
    const destination = forkOwner.value.trim()
    if (destination && (!destination.split('/').every(part => /^[\w][\w.-]*$/.test(part))
      || (selected.provider !== 'gitlab' && destination.includes('/')))) throw new Error(t('publishing.invalid_repo'))
    const binding = { source_id: selected.id, provider: selected.provider, base_url: selected.base_url,
      repo_owner: repository.value.repo_owner.trim(), repo_name: repository.value.repo_name.trim(), branch,
      branch_strategy: subdir ? 'shared_repo_subdir' : 'dedicated_repo', subdir, fork_policy: 'auto',
      ...(destination ? { fork_owner: destination } : {}) }
    validateProjectBinding(binding)
    if (password.value.trim()) inventory.setToken(selected.id, password.value.trim())
    const token = inventory.getToken(selected.id)
    password.value = ''
    busy.value = true
    const reviewed = await loadGitProject(binding, projects.projects.map(project => project.id))
    if (current !== request || !props.open || identity !== sourceIdentity.value) return
    if (inventory.getToken(selected.id) !== token) throw new Error(t('reopening.source_changed'))
    reviewedConnection = { identity, source_id: selected.id, token }
    preview.value = reviewed
    filesOnly.value = false
    await nextTick()
    heading.value?.focus()
  } catch (cause) { if (current === request) error.value = cause.message || String(cause) }
  finally { if (current === request) busy.value = false }
}

function importReviewed() {
  if (!preview.value || busy.value) return
  error.value = ''
  try {
    if (!reviewedConnection || reviewedConnection.identity !== sourceIdentity.value
      || reviewedConnection.token !== inventory.getToken(reviewedConnection.source_id)) {
      preview.value = null
      reviewedConnection = null
      throw new Error(t('reopening.source_changed'))
    }
    const project = prepareGitProjectImport(preview.value, filesOnly.value ? 'files' : 'structured')
    const imported = projects.importProject(project, { generateNewId: false })
    emit('opened', imported)
  } catch (cause) { error.value = cause.message || String(cause) }
}
function back() { preview.value = null; reviewedConnection = null; error.value = ''; filesOnly.value = false }
</script>

<template>
  <FocusTrap v-if="open" :active="focusReady" :fallback-focus="() => heading" :escape-deactivates="false">
    <div class="modal modal-open z-[1000] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="open-git-title" @keydown.esc.prevent="emit('close')">
      <section class="modal-box w-full max-w-3xl max-h-[92vh] min-w-0 overflow-y-auto space-y-4">
        <header class="flex justify-between gap-3 items-start">
          <h2 id="open-git-title" ref="heading" tabindex="-1" class="font-bold text-xl">{{ t('reopening.title') }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">{{ t('publishing.close') }}</button>
        </header>
        <template v-if="!preview">
          <p class="text-sm">{{ t('reopening.hint') }}</p>
          <p v-if="!inventory.sources.length" class="text-sm">{{ t('publishing.no_sources') }} <a href="/sources" class="link">{{ t('publishing.manage_sources') }}</a></p>
          <PublishRepositoryFields v-model="repository" :sources="inventory.sources" :disabled="busy" />
          <label v-if="source" class="block">
            <span class="label text-sm">{{ t('publishing.credentials_title') }}</span>
            <span v-if="inventory.getToken(source.id)" class="text-success block text-sm">{{ t('publishing.credential_connected') }}</span>
            <input v-model="password" type="password" autocomplete="new-password" :disabled="busy" class="input input-bordered w-full" data-testid="open-git-credential" :placeholder="t('publishing.credential_placeholder')" />
            <span class="block text-xs text-base-content/70 mt-1">{{ t('publishing.credentials_hint') }}</span>
          </label>
          <ForkDestinationField v-model="forkOwner" :disabled="busy" />
          <p class="text-sm text-base-content/70">{{ t('reopening.fork_hint') }}</p>
          <p class="text-xs text-base-content/70">{{ t('reopening.limits') }}</p>
        </template>
        <template v-else>
          <h3 class="font-semibold text-lg break-words">{{ preview.name }}</h3>
          <dl class="grid gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)] text-sm">
            <dt>{{ t('reopening.repository') }}</dt><dd class="break-all">{{ preview.binding.repo_owner }}/{{ preview.binding.repo_name }}{{ preview.binding.subdir ? ` · ${preview.binding.subdir}` : '' }}</dd>
            <dt>{{ t('reopening.revision') }}</dt><dd class="break-all font-mono" data-testid="open-git-revision">{{ preview.revision.branch }} · {{ preview.revision.commit_sha }}</dd>
            <dt>{{ t('reopening.identity') }}</dt><dd class="break-all font-mono">{{ preview.local_id }}</dd>
            <dt>{{ t('reopening.working_branch') }}</dt><dd class="break-all font-mono">{{ preview.binding.working_branch }}</dd>
          </dl>
          <p class="text-sm">{{ t(preview.identity_reused ? 'reopening.identity_reused' : 'reopening.identity_copy') }}</p>
          <p class="text-sm">{{ t('reopening.seed_hint') }}</p>
          <p class="text-sm">{{ t('reopening.graph', { nodes: preview.canvas.nodes.length, edges: preview.canvas.edges.length }) }}</p>
          <div class="rounded-lg border border-base-300 bg-base-200 p-3 space-y-2 text-sm" data-testid="open-git-authoring">
            <p>{{ t(`reopening.status_${preview.authoring.status}`) }}</p>
            <p v-if="preview.authoring.issue" class="break-words">{{ preview.authoring.issue }}</p>
            <label v-if="preview.authoring.status === 'conflict'" class="flex items-start gap-2">
              <input v-model="filesOnly" type="checkbox" class="checkbox checkbox-sm shrink-0" data-testid="open-git-files-only" />
              <span>{{ t('reopening.files_only') }}</span>
            </label>
          </div>
          <details class="text-sm">
            <summary class="cursor-pointer">{{ t('reopening.files', { count: reviewedFiles.length }) }}</summary>
            <ul class="mt-2 max-h-48 overflow-y-auto space-y-1">
              <li v-for="file in reviewedFiles" :key="file.path" class="break-all font-mono">{{ file.path }} · {{ file.bytes }} B{{ file.binary ? ` · ${t('reopening.binary')}` : '' }}</li>
            </ul>
          </details>
        </template>
        <p v-if="error" role="alert" class="text-error text-sm break-words">{{ error }}</p>
        <p v-if="busy" role="status" class="text-sm">{{ t('reopening.loading') }}</p>
        <footer class="flex flex-wrap justify-end gap-2">
          <button v-if="preview" type="button" class="btn btn-ghost" @click="back">{{ t('reopening.back') }}</button>
          <button v-if="!preview" type="button" class="btn btn-primary" :disabled="busy" data-testid="open-git-preview" @click="review">{{ t('reopening.preview') }}</button>
          <button v-else type="button" class="btn btn-primary" :disabled="busy || (preview.authoring.status === 'conflict' && !filesOnly)" data-testid="open-git-import" @click="importReviewed">{{ t('reopening.import') }}</button>
        </footer>
      </section>
      <div class="modal-backdrop" aria-hidden="true" @click="emit('close')" />
    </div>
  </FocusTrap>
</template>

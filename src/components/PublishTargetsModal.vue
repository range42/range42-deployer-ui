<script setup lang="ts">
import { randomId } from '@/services/randomId'
import { cloneFiles, type ProjectFiles } from '@/services/projectFiles'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useCatalogSources } from '@/composables/useCatalogSources'
import {
  publishFilesToTargets,
  workingBranchForProject,
  type ProjectGitBinding,
  type ProjectPublishTarget,
  type ForkPolicy,
} from '@/composables/useProjectGitSync'
import PublishRepositoryFields from '@/components/PublishRepositoryFields.vue'
import PublicationReviewActions from '@/components/PublicationReviewActions.vue'
import ForkDestinationField from '@/components/ForkDestinationField.vue'

type PublishResult = Awaited<ReturnType<typeof publishFilesToTargets>>
type TargetResult = PublishResult['targets'][number]
type RepositoryDraft = Pick<ProjectPublishTarget, 'source_id' | 'repo_owner' | 'repo_name' | 'base_branch' | 'subdir'>
type TargetDraft = ProjectPublishTarget & { selected: boolean }
interface Preview {
  projectId: string
  binding: ProjectGitBinding
  files: ProjectFiles
  targets: ProjectPublishTarget[]
  message: string
  sourceSignatures: Record<string, string>
  createOnly: boolean
  componentPath?: string
}

const props = withDefaults(defineProps<{
  open: boolean
  projectId: string
  binding?: ProjectGitBinding
  files: ProjectFiles
  message: string
  initialTargets?: ProjectPublishTarget[]
  createOnly?: boolean
  componentPath?: string
}>(), { initialTargets: () => [], createOnly: false })
const emit = defineEmits<{
  close: []
  published: [result: PublishResult]
  reviewed: [result: TargetResult]
  'update:targets': [targets: ProjectPublishTarget[]]
}>()
const { t } = useI18n()
const inventory = useInventoryStore()
const { loadSources, loading } = useCatalogSources()
const sources = computed(() => inventory.sources)
const stage = ref<'edit' | 'review' | 'results'>('edit')
const busy = ref(false)
const error = ref('')
const sourceError = ref('')
const targets = ref<TargetDraft[]>([])
const working = ref<RepositoryDraft>({ source_id: '', repo_owner: '', repo_name: '', base_branch: 'main' })
const preview = ref<Preview | null>(null)
const results = ref<Record<string, TargetResult>>({})
const checkpoint = ref<{ branch: string; commit_sha: string } | null>(null)
const credentialInputs = ref<Record<string, string>>({})
const credentialSources = computed(() => {
  const ids = preview.value && stage.value !== 'edit'
    ? Object.keys(preview.value.sourceSignatures)
    : [props.binding?.source_id || working.value.source_id,
      ...targets.value.filter((target) => target.selected).map((target) => target.source_id)]
  return sources.value.filter((source) => ids.includes(source.id))
})
const closeButton = ref<HTMLButtonElement | null>(null)
const titleElement = ref<HTMLElement | null>(null)
const focusReady = ref(false)
let opener: HTMLElement | null = null

onMounted(() => ensureNamespaces(['publishing']))
watch(() => props.open, async (open) => {
  focusReady.value = false
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stage.value = 'edit'
    error.value = ''
    sourceError.value = ''
    preview.value = null
    results.value = {}
    checkpoint.value = null
    credentialInputs.value = {}
    targets.value = props.initialTargets.map((target) => ({ ...target, selected: false }))
    working.value = { source_id: '', repo_owner: '', repo_name: '', base_branch: 'main' }
    if (!sources.value.length) void reloadSources()
    await nextTick()
    if (props.open) {
      focusReady.value = true
      closeButton.value?.focus()
    }
  } else {
    opener?.focus()
    opener = null
  }
}, { immediate: true })
watch(() => sources.value.map((source) => sourceSignature(source.id)).join('|'), () => {
  credentialInputs.value = {}
})

async function reloadSources() {
  sourceError.value = ''
  try { await loadSources() }
  catch (cause) { sourceError.value = cause instanceof Error ? cause.message : t('publishing.source_error') }
}

function close() { if (!busy.value) emit('close') }
function sourceSignature(id: string): string {
  const source = sources.value.find((item) => item.id === id)
  return source ? JSON.stringify([source.id, source.provider, source.base_url, source.backend_url]) : ''
}
function connectCredential(sourceId: string) {
  const token = credentialInputs.value[sourceId]?.trim()
  if (!token) { error.value = t('publishing.enter_credential'); return }
  inventory.setToken(sourceId, token)
  credentialInputs.value[sourceId] = ''
  error.value = inventory.getToken(sourceId) ? '' : t('publishing.credential_storage_error')
}
function addTarget() {
  targets.value.push({
    id: `publish-${randomId()}`, source_id: '', provider: 'github', base_url: '',
    repo_owner: '', repo_name: '', base_branch: 'main', mode: 'pull_request', selected: true,
  })
}
function validBranch(branch: string) {
  return Boolean(branch) && !branch.startsWith('-') && !Array.from(branch).some((character) =>
    character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || '~^:?*[\\'.includes(character))
    && branch !== '@' && !branch.includes('..') && !branch.includes('@{')
    && branch.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'))
}
function validPath(path: string, allowEmpty = false) {
  return (allowEmpty && !path) || (Boolean(path) && !path.includes('\\')
    && !Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && path.split('/').every((part) => part && part !== '.' && part !== '..'))
}
function resolveRepository(draft: RepositoryDraft) {
  const source = sources.value.find((item) => item.id === draft.source_id)
  if (!source) throw new Error(t('publishing.choose_source'))
  const owner = draft.repo_owner.trim()
  const repo = draft.repo_name.trim()
  const branch = draft.base_branch.trim()
  const subdir = draft.subdir?.trim().replace(/\/+$/, '') || ''
  if (!owner.split('/').every((part) => /^[\w][\w.-]*$/.test(part)) || !/^[\w][\w.-]*$/.test(repo)
    || repo.endsWith('.git') || (source.provider !== 'gitlab' && owner.includes('/'))) {
    throw new Error(t('publishing.invalid_repo'))
  }
  if (!validBranch(branch)) throw new Error(t('publishing.invalid_branch'))
  if (!validPath(subdir, true)) throw new Error(t('publishing.invalid_path'))
  return { source_id: source.id, provider: source.provider, base_url: source.base_url,
    repo_owner: owner, repo_name: repo, base_branch: branch, ...(subdir ? { subdir } : {}) }
}

function review() {
  error.value = ''
  try {
    const selected = targets.value.filter((target) => target.selected)
    if (!selected.length) throw new Error(t('publishing.select_destination'))
    const resolvedTargets: ProjectPublishTarget[] = selected.map((target) => ({
      id: target.id, ...resolveRepository(target), mode: target.mode,
      ...(target.fork_policy ? { fork_policy: target.fork_policy } : {}),
      ...(target.mode === 'pull_request' && target.fork_policy !== 'upstream' && target.fork_owner?.trim() ? { fork_owner: target.fork_owner.trim() } : {}),
    }))
    for (const target of resolvedTargets) {
      if (target.fork_owner && (!target.fork_owner.split('/').every(part => /^[\w][\w.-]*$/.test(part))
        || (target.provider !== 'gitlab' && target.fork_owner.includes('/')))) throw new Error(t('publishing.invalid_repo'))
    }
    const identities = resolvedTargets.map((target) => JSON.stringify([
      target.base_url, target.repo_owner, target.repo_name, target.base_branch, target.subdir || '',
    ]))
    if (new Set(identities).size !== identities.length) throw new Error(t('publishing.duplicate_destination'))
    const primary = props.binding ? resolveRepository({
      source_id: props.binding.source_id, repo_owner: props.binding.repo_owner,
      repo_name: props.binding.repo_name, base_branch: props.binding.branch || 'main', subdir: props.binding.subdir,
    }) : resolveRepository(working.value)
    if (props.binding && (primary.base_url !== props.binding.base_url || primary.provider !== props.binding.provider)) {
      throw new Error(t('publishing.source_changed'))
    }
    const binding: ProjectGitBinding = props.binding ? { ...props.binding } : {
      source_id: primary.source_id, provider: primary.provider, base_url: primary.base_url,
      repo_owner: primary.repo_owner, repo_name: primary.repo_name, branch: primary.base_branch,
      branch_strategy: primary.subdir ? 'shared_repo_subdir' : 'dedicated_repo',
      ...(primary.subdir ? { subdir: primary.subdir } : {}),
    }
    const files = cloneFiles(props.files)
    if (!Object.keys(files).length) throw new Error(t('publishing.no_files'))
    if (Object.keys(files).some((path) => !validPath(path))) throw new Error(t('publishing.invalid_path'))
    const sourceIds = new Set([binding.source_id, ...resolvedTargets.map((target) => target.source_id)])
    preview.value = { projectId: props.projectId, binding, files, targets: resolvedTargets, message: props.message,
      sourceSignatures: Object.fromEntries([...sourceIds].map((id) => [id, sourceSignature(id)])),
      createOnly: props.createOnly, componentPath: props.componentPath }
    results.value = {}
    checkpoint.value = null
    stage.value = 'review'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('publishing.review_error') }
}

async function publish(onlyTarget?: ProjectPublishTarget) {
  const plan = preview.value
  if (!plan || busy.value) return
  error.value = ''
  if (Object.entries(plan.sourceSignatures).some(([id, signature]) => sourceSignature(id) !== signature)) {
    error.value = t('publishing.source_changed')
    return
  }
  const selected = onlyTarget ? [onlyTarget] : plan.targets.filter((target) => results.value[target.id]?.status !== 'published')
  if (!selected.length) return
  const requiredSources = new Set([plan.binding.source_id, ...selected.map((target) => target.source_id)])
  if ([...requiredSources].some((id) => !inventory.getToken(id))) {
    error.value = t('publishing.missing_credential')
    return
  }
  busy.value = true
  stage.value = 'results'
  try {
    const result = await publishFilesToTargets({
      projectId: plan.projectId, binding: plan.binding, files: plan.files, message: plan.message,
      createOnly: plan.createOnly, componentPath: plan.componentPath,
    }, selected)
    checkpoint.value = { branch: result.branch, commit_sha: result.commit_sha }
    if (result.binding) plan.binding = result.binding
    for (const target of result.targets) results.value[target.target_id] = target
    emit('update:targets', plan.targets)
    emit('published', { ...result, targets: plan.targets.flatMap((target) => results.value[target.id] ? [results.value[target.id]] : []) })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('publishing.publish_error') }
  finally { busy.value = false }
}

function recordReview(result: TargetResult) {
  results.value[result.target_id] = result
  emit('reviewed', result)
}

function safeUrl(value?: string) {
  try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined }
  catch { return undefined }
}
</script>

<template>
  <FocusTrap v-if="open" :active="focusReady" :initial-focus="() => closeButton"
    :fallback-focus="() => titleElement" :escape-deactivates="false">
    <div class="modal modal-open z-[1000]" role="dialog" aria-modal="true"
      aria-labelledby="publish-title" aria-describedby="publish-description" @keydown.esc.prevent="close">
      <div class="modal-box w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="publish-title" ref="titleElement" tabindex="-1" class="text-xl font-bold">{{ t('publishing.title') }}</h2>
            <p id="publish-description" class="text-sm text-base-content/70 mt-1">{{ t('publishing.description') }}</p>
          </div>
          <button ref="closeButton" type="button" class="btn btn-sm btn-ghost" :disabled="busy" @click="close">{{ t('publishing.close') }}</button>
        </div>
        <p class="text-sm mb-4 break-words">{{ stage === 'edit' ? message : preview?.message }}</p>
        <div v-if="stage === 'edit'" class="space-y-5">
          <section v-if="!binding" data-testid="working-repository" class="rounded-xl border border-base-300 p-4">
            <h3 class="font-semibold">{{ t('publishing.working_repository') }}</h3>
            <p class="text-sm text-base-content/70 mb-3">{{ t('publishing.working_hint') }}</p>
            <PublishRepositoryFields v-model="working" :sources="sources" />
          </section>
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-semibold">{{ t('publishing.destinations') }}</h3>
            <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="reloadSources">{{ t('publishing.reload_sources') }}</button>
          </div>
          <p v-if="!sources.length" class="text-sm">{{ t('publishing.no_sources') }} <a href="/sources" class="link">{{ t('publishing.manage_sources') }}</a></p>
          <p v-if="sourceError" role="alert" class="text-error text-sm">{{ sourceError }}</p>
          <section v-for="(target, index) in targets" :key="target.id" data-testid="publish-target"
            class="rounded-xl border border-base-300 p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 font-semibold">
                <input v-model="target.selected" type="checkbox" class="checkbox checkbox-sm" data-testid="target-selected" />
                {{ t('publishing.destination_number', { number: index + 1 }) }}
              </label>
              <button type="button" class="btn btn-ghost btn-sm" @click="targets.splice(index, 1)">{{ t('publishing.remove') }}</button>
            </div>
            <PublishRepositoryFields v-model="targets[index]" :sources="sources" />
            <label class="block">
              <span class="label text-sm">{{ t('publishing.method') }}</span>
              <select v-model="target.mode" class="select select-bordered w-full" data-testid="publish-mode">
                <option value="pull_request">{{ t('publishing.pull_request') }}</option>
                <option value="direct">{{ t('publishing.direct') }}</option>
              </select>
            </label>
            <label v-if="target.mode === 'pull_request'" class="block">
              <span class="label text-sm">{{ t('publishing.fork_policy') }}</span>
              <select :value="target.fork_policy || 'auto'" class="select select-bordered w-full" data-testid="fork-policy"
                @change="target.fork_policy = ($event.target as HTMLSelectElement).value as ForkPolicy">
                <option value="auto">{{ t('publishing.fork_auto') }}</option>
                <option value="fork">{{ t('publishing.fork_always') }}</option>
                <option value="upstream">{{ t('publishing.fork_never') }}</option>
              </select>
            </label>
            <ForkDestinationField v-if="target.mode === 'pull_request' && target.fork_policy !== 'upstream'" v-model="target.fork_owner" />
          </section>
          <button type="button" class="btn btn-outline btn-sm" data-testid="add-target" :disabled="!sources.length" @click="addTarget">{{ t('publishing.add_destination') }}</button>
          <p class="text-sm text-base-content/70">{{ t('publishing.permission_hint') }}</p>
        </div>

        <section v-if="stage === 'edit' && binding?.publish_results?.length" class="space-y-3 mt-5">
          <h3 class="font-semibold">{{ t('publishing.previous_publications') }}</h3>
          <article v-for="result in binding.publish_results" :key="result.target_id" class="rounded-xl border border-base-300 p-4 text-sm">
            <p v-if="result.destination" class="font-semibold break-all">{{ result.destination.repo_owner }}/{{ result.destination.repo_name }} → {{ result.destination.base_branch }}</p>
            <a v-if="safeUrl(result.pr_url)" :href="safeUrl(result.pr_url)" class="link" target="_blank" rel="noopener noreferrer">{{ t('publishing.view_pr') }}</a>
            <PublicationReviewActions :result="result" @updated="recordReview" />
          </article>
        </section>

        <section v-if="preview && stage !== 'edit'" data-testid="publish-preview" class="space-y-4">
          <div class="rounded-xl bg-base-200 p-4 text-sm space-y-1">
            <h3 class="font-semibold">{{ t('publishing.working_checkpoint') }}</h3>
            <p class="break-all">{{ preview.binding.base_url }}/{{ preview.binding.repo_owner }}/{{ preview.binding.repo_name }}</p>
            <p>{{ preview.binding.working_branch || workingBranchForProject(preview.projectId) }}</p>
            <p v-if="checkpoint" class="font-mono break-all">{{ checkpoint.branch }} · {{ checkpoint.commit_sha }}</p>
            <p>{{ t('publishing.checkpoint_fork_hint') }}</p>
            <p v-if="preview.createOnly">{{ t('publishing.new_files_only') }}</p>
          </div>
          <div v-for="target in preview.targets" :key="target.id" class="rounded-xl border border-base-300 p-4 text-sm space-y-2">
            <p class="font-semibold break-all">{{ target.base_url }}/{{ target.repo_owner }}/{{ target.repo_name }}</p>
            <p>{{ t(target.mode === 'direct' ? 'publishing.direct' : 'publishing.pull_request') }} → <code>{{ target.base_branch }}</code></p>
            <p v-if="target.mode === 'pull_request'">{{ t(target.fork_policy === 'fork' ? 'publishing.fork_always' : target.fork_policy === 'upstream' ? 'publishing.fork_never' : 'publishing.fork_auto') }}</p>
            <p v-if="target.fork_owner" class="break-all">{{ t('publishing.fork_owner') }}: {{ target.fork_owner }}</p>
            <ul class="list-disc pl-5 break-all">
              <li v-for="path in Object.keys(preview.files)" :key="path">{{ target.subdir ? `${target.subdir}/${path}` : path }}</li>
            </ul>
            <div v-if="results[target.id]" aria-live="polite">
              <p v-if="results[target.id].status === 'published'" class="text-success">{{ t('publishing.published') }}</p>
              <template v-else>
                <p class="text-error" role="alert">{{ results[target.id].error || t('publishing.publish_error') }}</p>
                <button type="button" class="btn btn-outline btn-sm mt-2" :data-testid="`retry-${target.id}`" :disabled="busy" @click="publish(target)">{{ t('publishing.retry_destination') }}</button>
              </template>
              <a v-if="safeUrl(results[target.id].pr_url)" :href="safeUrl(results[target.id].pr_url)" target="_blank" rel="noopener noreferrer" class="link">{{ t('publishing.view_pr') }}</a>
              <PublicationReviewActions :result="results[target.id]" @updated="recordReview" />
              <p v-if="results[target.id].fork" class="break-all">{{ t('publishing.fork_result', { repository: `${results[target.id].fork?.owner}/${results[target.id].fork?.repo}` }) }} · {{ results[target.id].branch }}</p>
              <p v-if="results[target.id].commit_sha" class="font-mono break-all">{{ results[target.id].commit_sha }}</p>
            </div>
          </div>
          <details v-for="(content, path) in preview.files" :key="path" class="rounded-lg bg-base-200 p-3">
            <summary class="cursor-pointer font-mono text-sm break-all">{{ path }}</summary>
            <pre v-if="typeof content === 'string'" class="text-xs whitespace-pre-wrap break-words overflow-x-auto mt-3">{{ content }}</pre>
            <p v-else class="text-sm mt-3">Binary file · {{ content.size }} bytes · {{ content.media_type || 'application/octet-stream' }}. The same bytes will be published to each selected destination.</p>
          </details>
        </section>
        <section v-if="credentialSources.length" class="rounded-xl border border-base-300 p-4 mt-5 space-y-3">
          <h3 class="font-semibold">{{ t('publishing.credentials_title') }}</h3>
          <p class="text-sm text-base-content/70">{{ t('publishing.credentials_hint') }}</p>
          <div v-for="source in credentialSources" :key="source.id" class="space-y-2">
            <label class="block text-sm">
              <span class="label break-all">{{ source.name || source.base_url }} · {{ source.provider }}</span>
              <span v-if="inventory.getToken(source.id)" class="text-success block mb-2">{{ t('publishing.credential_connected') }}</span>
              <input v-model="credentialInputs[source.id]" type="password" autocomplete="new-password"
                class="input input-bordered w-full" :disabled="busy" :placeholder="t('publishing.credential_placeholder')"
                :data-testid="`publishing-credential-${source.id}`" />
            </label>
            <button type="button" class="btn btn-outline btn-sm" :disabled="busy || !credentialInputs[source.id]?.trim()"
              :data-testid="`connect-credential-${source.id}`" @click="connectCredential(source.id)">{{ t('publishing.connect_credential') }}</button>
          </div>
        </section>
        <p v-if="error" role="alert" class="text-error text-sm mt-4">{{ error }}</p>
        <div class="modal-action items-center">
          <p v-if="busy" role="status" class="text-sm"><span class="loading loading-spinner loading-xs mr-2" />{{ t('publishing.publishing') }}</p>
          <button v-if="stage === 'edit'" type="button" class="btn btn-primary" data-testid="review-publish" @click="review">{{ t('publishing.review') }}</button>
          <template v-else>
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="stage = 'edit'; error = ''">{{ t('publishing.edit_destinations') }}</button>
            <button v-if="stage === 'review' || error" type="button" class="btn btn-primary" data-testid="confirm-publish" :disabled="busy" @click="publish()">{{ t('publishing.publish_selected') }}</button>
          </template>
        </div>
      </div>
      <div class="modal-backdrop" aria-hidden="true" @click="close" />
    </div>
  </FocusTrap>
</template>

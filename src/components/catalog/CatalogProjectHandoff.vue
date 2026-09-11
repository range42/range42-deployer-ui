<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import ProjectRepositoryConnection from '@/components/ProjectRepositoryConnection.vue'
import { useCatalog, type CatalogEntry } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { providerForBinding, type ProjectGitBinding } from '@/composables/useProjectGitSync'
import { prepareCatalogProject, type CatalogProjectPreview } from '@/services/catalogProjectHandoff'
import { getBackendScope } from '@/services/backendApi'
import { randomId } from '@/services/randomId'
import { ensureNamespaces } from '@/i18n'

const props = defineProps<{ entry: CatalogEntry; mode: 'use' | 'customize' }>()
const emit = defineEmits<{ close: []; opened: [project: CatalogProjectPreview['project']] }>()
const { t } = useI18n()
const inventory = useInventoryStore()
const projects = useProjectStore()
const catalog = useCatalog()
const projectId = `project_${randomId().replace(/-/g, '')}`
const chosen = ref<ProjectGitBinding>()
const detail = ref<CatalogEntry>()
const preview = ref<CatalogProjectPreview>()
const phase = ref<'loading' | 'connection' | 'review'>('loading')
const busy = ref(false)
const error = ref('')
const heading = ref<HTMLElement | null>(null)
const focusReady = ref(false)
let epoch = 0
let reviewed: { identity: string; tokens: Array<[string, string | null]> } | null = null
const source = computed(() => inventory.getSource(props.entry.source_id))
const originIdentity = computed(() => JSON.stringify([getBackendScope(), props.entry.source_id, props.entry.path,
  props.entry.sha, props.entry.kind, props.mode, source.value?.id, source.value?.provider, source.value?.base_url,
  source.value?.backend_url, source.value?.repos]))
const destination = computed(() => chosen.value && inventory.getSource(chosen.value.source_id))
const identity = computed(() => JSON.stringify([originIdentity.value, chosen.value, destination.value?.id,
  destination.value?.provider, destination.value?.base_url, destination.value?.backend_url]))
watch(identity, () => {
  epoch += 1
  reviewed = null
  preview.value = undefined
  if (busy.value || phase.value !== 'connection') { busy.value = false; error.value = t('catalog.handoff.changed') }
})
watch(originIdentity, () => {
  // A new origin must fetch its own document. Never relabel the previous SHA
  // or canonical topology with a different repository after Back → Review.
  detail.value = undefined
  phase.value = 'review'
  error.value = t('catalog.handoff.origin_changed')
})
watch(phase, async value => {
  focusReady.value = false
  if (value !== 'connection') { await nextTick(); focusReady.value = true; heading.value?.focus() }
})
onBeforeUnmount(() => { epoch += 1; reviewed = null })
function close() { epoch += 1; reviewed = null; emit('close') }

onMounted(async () => {
  const current = ++epoch
  const originalIdentity = identity.value
  try {
    await ensureNamespaces(['catalog', 'publishing'])
    projects.loadProjects()
    const got = await catalog.getEntry(props.entry.source_id, props.entry.path)
    if (current !== epoch || identity.value !== originalIdentity) return
    if (!got) throw new Error(t('catalog.handoff.missing'))
    detail.value = got
    const repo = source.value?.repos[0]
    if (source.value && repo) chosen.value = { source_id: source.value.id, provider: source.value.provider,
      base_url: source.value.base_url, repo_owner: repo.owner, repo_name: repo.repo, branch: repo.branch,
      subdir: `projects/${projectId}`, branch_strategy: 'shared_repo_subdir', fork_policy: 'auto' }
    phase.value = 'connection'
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : String(cause) }
})

async function review(binding: ProjectGitBinding) {
  chosen.value = { ...binding }
  await nextTick() // Invalidate previous source/destination work before capturing this request.
  phase.value = 'review'
  error.value = ''
  busy.value = true
  const current = ++epoch
  const currentIdentity = identity.value
  const tokens: Array<[string, string | null]> = [...new Set([props.entry.source_id, binding.source_id])]
    .map(id => [id, inventory.getToken(id)])
  try {
    if (!source.value || !detail.value) throw new Error(t('catalog.handoff.missing'))
    const result = await prepareCatalogProject({ entry: detail.value, source: source.value, binding, mode: props.mode, projectId }, providerForBinding(binding))
    if (current !== epoch) return
    if (currentIdentity !== identity.value || tokens.some(([id, token]) => inventory.getToken(id) !== token)) throw new Error(t('catalog.handoff.changed'))
    preview.value = result
    reviewed = { identity: currentIdentity, tokens }
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (current === epoch) busy.value = false }
}
function importReviewed() {
  if (!preview.value || busy.value) return
  error.value = ''
  try {
    if (!reviewed || reviewed.identity !== identity.value || reviewed.tokens.some(([id, token]) => inventory.getToken(id) !== token)) {
      preview.value = undefined
      throw new Error(t('catalog.handoff.changed'))
    }
    const imported = projects.importProject(JSON.parse(JSON.stringify(preview.value.project)), { generateNewId: false })
    emit('opened', imported)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
function back() { epoch += 1; preview.value = undefined; reviewed = null; error.value = ''; busy.value = false; phase.value = 'connection' }
</script>

<template>
  <ProjectRepositoryConnection v-if="phase === 'connection'" :open="true" :binding="chosen" @close="close" @connected="review" />
  <FocusTrap v-else :active="focusReady" :fallback-focus="() => heading" :escape-deactivates="false">
    <div class="modal modal-open z-[1000] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="catalog-handoff-title" @keydown.esc.prevent="close">
      <section class="modal-box w-full max-w-2xl max-h-[92vh] overflow-y-auto space-y-4">
        <header class="flex items-start justify-between gap-3">
          <h2 id="catalog-handoff-title" ref="heading" tabindex="-1" class="text-xl font-bold">{{ t('catalog.handoff.title') }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-testid="catalog-handoff-close" @click="close">{{ t('publishing.close') }}</button>
        </header>
        <p class="text-sm break-all">{{ t('catalog.handoff.origin') }}: {{ entry.source_id }} · {{ entry.path }} · {{ detail?.sha || entry.sha }}</p>
        <p class="text-sm">{{ t(entry.kind === 'ansible_role' ? 'catalog.handoff.role_scope' : 'catalog.handoff.scope') }}</p>
        <div v-if="preview" class="space-y-3" data-testid="catalog-handoff-preview">
          <dl class="grid gap-2 text-sm">
            <dt>{{ t('catalog.handoff.destination') }}</dt><dd class="font-mono break-all">{{ preview.project.git.repo_owner }}/{{ preview.project.git.repo_name }} · {{ preview.project.git.subdir || '/' }}</dd>
            <dt>{{ t('catalog.handoff.branch') }}</dt><dd class="font-mono break-all">{{ preview.project.git.working_branch }}</dd>
            <dt>{{ t('catalog.handoff.seed') }}</dt><dd class="font-mono break-all">{{ preview.project.git.branch }} · {{ preview.project.git.branch_from }}</dd>
          </dl>
          <p v-if="!preview.role" class="text-sm">{{ t('catalog.handoff.counts', { nodes: preview.project.nodes.length, edges: preview.project.edges.length, attachments: preview.project.attachments.length }) }}</p>
          <details v-if="preview.role" class="text-sm">
            <summary>{{ t('catalog.handoff.role_files', { count: Object.keys(preview.project.files).length }) }}</summary>
            <ul class="mt-2 max-h-48 overflow-auto font-mono text-xs space-y-1"><li v-for="path in Object.keys(preview.project.files)" :key="path" class="break-all">{{ path }}</li></ul>
          </details>
          <p v-if="preview.pendingFork" class="rounded-lg bg-warning/15 p-3 text-sm">{{ t('catalog.handoff.fork_pending') }} {{ preview.project.git.fork_owner || '' }}</p>
          <p class="text-sm">{{ t('catalog.handoff.save_hint') }}</p>
        </div>
        <p v-if="error" role="alert" class="text-error text-sm break-words">{{ error }}</p>
        <p v-if="busy || (phase === 'loading' && !error)" role="status" class="text-sm">{{ t('catalog.handoff.loading') }}</p>
        <footer class="flex flex-wrap justify-end gap-2">
          <button v-if="detail" type="button" class="btn btn-ghost" :disabled="busy" @click="back">{{ t('catalog.handoff.back') }}</button>
          <button v-if="preview" type="button" class="btn btn-primary" data-testid="catalog-handoff-import" :disabled="busy" @click="importReviewed">{{ t('catalog.handoff.import') }}</button>
        </footer>
      </section>
    </div>
  </FocusTrap>
</template>

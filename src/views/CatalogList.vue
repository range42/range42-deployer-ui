<script setup>
import { randomId } from '@/services/randomId'
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCatalog, applyClientFilters } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogAppendDialog from '@/components/catalog/CatalogAppendDialog.vue'
import CatalogTile from '@/components/ui/CatalogTile.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import NewRoleModal from '@/components/catalog/NewRoleModal.vue'
import NewMachineModal from '@/components/catalog/NewMachineModal.vue'
import NewContainerModal from '@/components/catalog/NewContainerModal.vue'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import { ensureNamespaces } from '@/i18n'
import { useCatalogSourceAccess } from '@/composables/useCatalogSourceAccess'
import { catalogBrowseQuery, catalogKinds } from '@/services/catalogPresentation'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const inv = useInventoryStore()
const projects = useProjectStore()
const backend = useBackendApiStore()
const catalog = useCatalog()
const sourceAccess = useCatalogSourceAccess()
const sourceError = sourceAccess.error
const sourcesLoading = sourceAccess.loading
// Expose composable refs as top-level template bindings for clean unwrap.
const entries = catalog.entries
const loading = catalog.loading
const loadError = catalog.error

function setFilter(key, value) {
  const query = { ...route.query, [key]: value || undefined, shown: undefined }
  if (Array.isArray(value) && !value.length) delete query[key]
  return router.replace({ query })
}
function textFilter(key) {
  return computed({ get: () => typeof route.query[key] === 'string' ? route.query[key] : '', set: value => setFilter(key, value) })
}
function listFilter(key) {
  return computed({ get: () => [route.query[key]].flat().filter(value => typeof value === 'string'), set: value => setFilter(key, value) })
}
const selectedKinds = listFilter('kind')
const selectedSources = listFilter('source')
const selectedOs = textFilter('os')
const selectedDifficulty = textFilter('difficulty')
const tagInput = textFilter('tags')
const searchQuery = textFilter('q')
const browseQuery = computed(() => catalogBrowseQuery(route.query))
const advancedFilterCount = computed(() => selectedSources.value.length + Number(!!selectedOs.value) + Number(!!selectedDifficulty.value) + Number(!!tagInput.value))
const newItemMenu = ref(null)
const newRoleOpen = ref(false)
const newMachineOpen = ref(false)
const newContainerOpen = ref(false)
const draftKind = ref('role')
const rolePublisherOpen = ref(false)
const roleDraft = ref(null)
const roleDraftId = ref('')
const addition = ref(null)
const addedMessage = ref('')
const targetProjectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const targetNodeId = computed(() => typeof route.query.node === 'string' ? route.query.node : '')
const targetProject = computed(() => projects.getProject(targetProjectId.value))

function openAddition(item) { addedMessage.value = ''; addition.value = item }
function onAdded(result) {
  addition.value = null
  if (result.open) {
    router.push({ path: `/project/${result.projectId}`, query: { tab: result.tab,
      ...(result.nodeId ? { node: result.nodeId } : {}), ...(result.file ? { file: result.file } : {}) } })
  } else {
    addedMessage.value = t('catalog.append.added', { project: projects.getProject(result.projectId)?.name || result.projectId })
    router.replace({ query: { ...route.query, project: result.projectId } })
  }
}

function openNewRole() {
  newItemMenu.value?.removeAttribute('open')
  draftKind.value = 'role'
  roleDraftId.value = `catalog-role-${randomId()}`
  roleDraft.value = null
  newRoleOpen.value = true
}

function openNewMachine() {
  newItemMenu.value?.removeAttribute('open')
  draftKind.value = 'machine'
  roleDraftId.value = `catalog-machine-${randomId()}`
  roleDraft.value = null
  newMachineOpen.value = true
}

function openNewContainer() {
  newItemMenu.value?.removeAttribute('open')
  draftKind.value = 'container'
  roleDraftId.value = `catalog-container-${randomId()}`
  roleDraft.value = null
  newContainerOpen.value = true
}

function publishRole(draft) {
  roleDraft.value = draft
  newRoleOpen.value = false
  newMachineOpen.value = false
  newContainerOpen.value = false
  rolePublisherOpen.value = true
}

function closeRolePublisher() {
  rolePublisherOpen.value = false
  if (draftKind.value === 'container') newContainerOpen.value = true
  else if (draftKind.value === 'machine') newMachineOpen.value = true
  else newRoleOpen.value = true
}

// Kinds the backend can emit (catalog/entries.py). `unknown` is a fallback
// bucket, not a useful filter facet, so it is intentionally omitted here.
const KINDS = catalogKinds
const DIFFICULTIES = ['easy', 'medium', 'hard']

// A source is read-only when its write-access probe came back explicitly false.
// A writable destination or reviewed fork still permits using these originals.
function isSourceReadonly(sourceId) {
  return inv.getSource(sourceId)?.writable === false
}

const parsedTags = computed(() =>
  tagInput.value
    ? tagInput.value.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
)

// All filtering is client-side. We fetch the full entry set once (the backend
// pages at `limit`) and keep `entries.value` as a stable superset, so toggling
// any control is instant and — crucially — never operates over a server-narrowed
// subset. (An earlier version narrowed server-side on single-select, which made
// widening a selection show too few results until a refetch resolved.)
const entriesView = computed(() =>
  applyClientFilters(entries.value, {
    kinds: selectedKinds.value,
    sources: selectedSources.value,
    tags: parsedTags.value,
    os: selectedOs.value || undefined,
    difficulty: selectedDifficulty.value || undefined,
    q: searchQuery.value || undefined,
  }),
)

const batchSize = 24
const visibleCount = computed({
  get: () => typeof route.query.shown === 'string' && /^\d+$/.test(route.query.shown)
    && Number.isSafeInteger(Number(route.query.shown)) ? Math.max(batchSize, Number(route.query.shown)) : batchSize,
  set: value => router.replace({ query: { ...route.query, shown: String(value) } }),
})
const visibleEntries = computed(() => entriesView.value.slice(0, visibleCount.value))

function toggleKind(kind) {
  selectedKinds.value = selectedKinds.value.includes(kind) ? selectedKinds.value.filter(value => value !== kind) : [...selectedKinds.value, kind]
}

function toggleSource(id) {
  selectedSources.value = selectedSources.value.includes(id) ? selectedSources.value.filter(value => value !== id) : [...selectedSources.value, id]
}

function clearFilters() {
  const query = { ...route.query }
  for (const key of Object.keys(catalogBrowseQuery(route.query))) delete query[key]
  router.replace({ query })
}

// The composable follows backend pages; filters use the resulting full set.
async function refresh() {
  await catalog.listEntries({ limit: 500 })
}

watch(() => [backend.url, backend.token], () => {
  handoff.value = null
  addition.value = null
  void refresh()
})

onMounted(async () => {
  await ensureNamespaces(['catalog', 'common', 'sources'])
  projects.loadProjects?.()
  await refresh()
})

// ----- Verb handlers -----

const handoff = ref(null)
function useEntry(item) {
  handoff.value = { entry: item, mode: 'use' }
}
function customizeEntry(item) {
  handoff.value = { entry: item, mode: 'customize' }
}
function openCreatedProject(project) {
  handoff.value = null
  router.push(`/project/${project.id}?tab=${project.native_scenario || project.catalogRef?.kind === 'ansible_role' ? 'config' : 'canvas'}`)
}

function openFork(entry) {
  handoff.value = { entry, mode: 'customize', publish: true }
}
</script>

<template>
  <CatalogProjectHandoff v-if="handoff" :key="`${handoff.entry.source_id}:${handoff.entry.path}:${handoff.mode}`"
    :entry="handoff.entry" :mode="handoff.mode" :publish-after-import="handoff.publish" @close="handoff = null" @opened="openCreatedProject" />
  <CatalogAppendDialog v-if="addition" :entry="addition" :initial-project-id="targetProjectId" :initial-node-id="targetNodeId" @close="addition = null" @added="onAdded" />
  <section class="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
    <header class="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">{{ t('catalog.title') }}</h1>
        <p class="text-sm text-base-content/70 mt-1">{{ t('catalog.subtitle') }}</p>
      </div>
      <details ref="newItemMenu" class="dropdown sm:dropdown-end self-start shrink-0">
        <summary class="btn btn-outline">{{ t('catalog.new_item') }}</summary>
        <ul class="dropdown-content menu z-20 mt-2 w-60 rounded-xl border border-base-300 bg-base-100 p-2 shadow-lg">
          <li><button type="button" data-testid="new-catalog-role" @click="openNewRole">{{ t('catalog.new_role') }}</button></li>
          <li><button type="button" data-testid="new-catalog-container" @click="openNewContainer">{{ t('catalog.new_container') }}</button></li>
          <li><button type="button" data-testid="new-catalog-machine" @click="openNewMachine">{{ t('catalog.new_machine') }}</button></li>
        </ul>
      </details>
    </header>
    <div v-if="targetProject" class="rounded-xl border border-primary/25 bg-primary/5 p-4 mb-5 flex flex-wrap items-center justify-between gap-3" data-testid="catalog-project-context">
      <div class="min-w-0"><p class="font-medium break-words">{{ t('catalog.append.context', { project: targetProject.name }) }}</p><p class="text-sm text-base-content/70 mt-1">{{ t('catalog.append.context_hint') }}</p></div>
      <RouterLink class="btn btn-outline btn-sm" :to="{ path: `/project/${targetProject.id}`, query: { tab: 'canvas', ...(targetNodeId ? { node: targetNodeId } : {}) } }">{{ t('catalog.append.return_project') }}</RouterLink>
    </div>
    <p v-else-if="targetProjectId" role="alert" class="alert alert-warning mb-4">{{ t('catalog.append.missing_project') }}</p>
    <p v-if="addedMessage" role="status" class="alert alert-success mb-4">{{ addedMessage }}</p>
    <div v-if="sourceError" class="alert alert-warning mb-4" role="alert" data-testid="catalog-source-error">
      <span class="text-sm break-words">{{ sourceError }}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-testid="catalog-source-retry" @click="sourceAccess.reload">{{ t('common.retry') }}</button>
    </div>
    <p v-else-if="sourcesLoading" class="text-sm text-base-content/65 mb-4" role="status">{{ t('catalog.sources_loading') }}</p>

    <NewRoleModal :key="`role:${roleDraftId}`" :open="newRoleOpen" @close="newRoleOpen = false" @prepared="publishRole" />
    <NewContainerModal :key="`container:${roleDraftId}`" :open="newContainerOpen" @close="newContainerOpen = false" @prepared="publishRole" />
    <NewMachineModal :key="`machine:${roleDraftId}`" :open="newMachineOpen" @close="newMachineOpen = false" @prepared="publishRole" />
    <PublishTargetsModal
      v-if="roleDraft"
      :open="rolePublisherOpen"
      :project-id="roleDraftId"
      :files="roleDraft.files"
      :message="`Add ${draftKind === 'machine' ? 'VM blueprint' : draftKind === 'container' ? 'Compose workload' : 'Ansible role'} ${roleDraft.name}`"
      :create-only="true"
      :component-path="roleDraft.path"
      @close="closeRolePublisher"
      @published="refresh"
    />

    <!-- Backend entries remain browsable before this browser loads its source mirror. -->
    <div v-if="inv.sources.length === 0 && entries.length === 0 && !loading && !loadError">
      <EmptyState
        :title="t('catalog.empty.no_sources_title')"
        :description="t('catalog.empty.no_sources_desc')"
      >
        <template #actions>
          <button class="btn btn-primary" @click="router.push('/sources')">
            {{ t('sources.add') }}
          </button>
        </template>
      </EmptyState>
    </div>

    <template v-else>
      <!-- Filter bar -->
      <div
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5 p-4 bg-base-200/40 rounded-xl"
        data-testid="catalog-filters"
      >
        <div class="md:col-span-2 lg:col-span-4">
          <label for="catalog-search" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.search') }}</label>
          <input
            id="catalog-search" name="search" autocomplete="off"
            v-model="searchQuery"
            type="search"
            class="input input-bordered w-full mt-1"
            :placeholder="t('catalog.filters.search')"
          />
        </div>

        <div class="md:col-span-2 lg:col-span-4">
          <p id="catalog-kind-label" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.kind') }}</p>
          <div class="flex flex-wrap gap-1 mt-1" role="group" aria-labelledby="catalog-kind-label">
            <button
              v-for="k in KINDS"
              :key="k"
              type="button"
              class="btn btn-sm"
              :data-kind-filter="k"
              :class="selectedKinds.includes(k) ? 'btn-primary' : 'btn-ghost'"
              :aria-pressed="selectedKinds.includes(k)"
              @click="toggleKind(k)"
            >
              {{ t(`catalog.kinds.${k}`) }}
            </button>
          </div>
        </div>

        <details class="md:col-span-2 lg:col-span-4" :open="advancedFilterCount > 0" data-testid="catalog-advanced-filters">
          <summary class="cursor-pointer text-sm font-medium py-2">{{ t('catalog.more_filters') }} <span v-if="advancedFilterCount" class="badge badge-sm badge-ghost ml-1">{{ advancedFilterCount }}</span></summary>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
            <div>
              <p id="catalog-source-label" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.source') }}</p>
              <div class="flex flex-wrap gap-1 mt-1" role="group" aria-labelledby="catalog-source-label">
                <button
                  v-for="s in inv.sources"
                  :key="s.id"
                  type="button"
                  class="btn btn-xs"
                  :class="selectedSources.includes(s.id) ? 'btn-primary' : 'btn-ghost'"
                  :aria-pressed="selectedSources.includes(s.id)"
                  @click="toggleSource(s.id)"
                >
                  {{ s.name || s.id }}
                </button>
              </div>
            </div>

            <div>
              <label for="catalog-os" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.os') }}</label>
              <input
                id="catalog-os" name="os" autocomplete="off"
                v-model="selectedOs"
                type="text"
                class="input input-bordered input-sm w-full mt-1"
                :placeholder="t('catalog.filters.os_any')"
              />
            </div>

            <div>
              <label for="catalog-difficulty" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.difficulty') }}</label>
              <select id="catalog-difficulty" v-model="selectedDifficulty" name="difficulty" class="select select-bordered select-sm w-full mt-1">
                <option value="">{{ t('catalog.filters.difficulty_any') }}</option>
                <option v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>

            <div>
              <label for="catalog-tags" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.tags') }}</label>
              <input
                id="catalog-tags" name="tags" autocomplete="off"
                v-model="tagInput"
                type="text"
                class="input input-bordered input-sm w-full mt-1"
                placeholder="tag1, tag2"
              />
            </div>
          </div>
        </details>

        <div class="md:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-base-content/60" role="status">{{ t('catalog.append.results', { count: entriesView.length, total: entries.length }) }}</p>
          <button type="button" class="btn btn-ghost btn-sm" @click="clearFilters">
            {{ t('catalog.filters.clear') }}
          </button>
        </div>
      </div>

      <!-- Loading skeletons -->
      <div
        v-if="loading && entriesView.length === 0"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="catalog-loading"
      >
        <div
          v-for="n in 6"
          :key="`skel-${n}`"
          class="card card-bordered bg-base-100 p-5"
        >
          <div class="skeleton h-5 w-3/4 mb-3"></div>
          <div class="skeleton h-3 w-1/2 mb-4"></div>
          <div class="skeleton h-4 w-full mb-2"></div>
          <div class="skeleton h-4 w-5/6"></div>
        </div>
      </div>

      <!-- Error banner (stale cache still shown below if entries exist) -->
      <div
        v-if="loadError"
        class="alert alert-warning mb-4"
        role="alert"
        data-testid="catalog-error"
      >
        <span class="text-sm">{{ loadError }}</span>
        <button class="btn btn-xs btn-ghost" @click="refresh">
          {{ t('common.retry') }}
        </button>
      </div>

      <!-- Tile grid -->
      <div
        v-if="entriesView.length"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="catalog-grid"
      >
        <div
          v-for="entry in visibleEntries"
          :key="`${entry.source_id}:${entry.path}`"
          class="relative"
        >
          <CatalogTile
            :entry="entry"
            :source-readonly="isSourceReadonly(entry.source_id)"
            :source-name="inv.getSource(entry.source_id)?.name || entry.source_id"
            :project-id="targetProjectId"
            :node-id="targetNodeId"
            :browse-query="browseQuery"
            :source-available="sourceAccess.available(entry.source_id)"
            @append="openAddition"
            @use="useEntry"
            @customize="customizeEntry"
            @fork="openFork"
          />
        </div>
      </div>
      <div v-else-if="!loading">
        <EmptyState
          :title="t('catalog.empty.no_entries_title')"
          :description="t('catalog.empty.no_entries_desc')"
        />
      </div>
      <div v-if="entriesView.length" class="mt-6 flex flex-col items-center gap-3">
        <p class="text-sm text-base-content/70" role="status" data-testid="catalog-visible-count">
          {{ t('catalog.visible_results', { count: visibleEntries.length, total: entriesView.length }) }}
        </p>
        <button v-if="visibleEntries.length < entriesView.length" type="button" class="btn btn-outline"
          data-testid="catalog-load-more" @click="visibleCount += batchSize">{{ t('catalog.load_more') }}</button>
      </div>
    </template>

  </section>
</template>

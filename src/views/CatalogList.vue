<script setup>
import { randomId } from '@/services/randomId'
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCatalog, applyClientFilters } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogAppendDialog from '@/components/catalog/CatalogAppendDialog.vue'
import CatalogTile from '@/components/ui/CatalogTile.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import NewRoleModal from '@/components/catalog/NewRoleModal.vue'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import { ensureNamespaces } from '@/i18n'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const inv = useInventoryStore()
const projects = useProjectStore()
const catalog = useCatalog()
// Expose composable refs as top-level template bindings for clean unwrap.
const entries = catalog.entries
const loading = catalog.loading
const loadError = catalog.error

const selectedKinds = ref([])
const selectedSources = ref([])
const selectedOs = ref('')
const selectedDifficulty = ref('')
const tagInput = ref('')
const searchQuery = ref('')
const newRoleOpen = ref(false)
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
  roleDraftId.value = `catalog-role-${randomId()}`
  roleDraft.value = null
  newRoleOpen.value = true
}

function publishRole(draft) {
  roleDraft.value = draft
  newRoleOpen.value = false
  rolePublisherOpen.value = true
}

function closeRolePublisher() {
  rolePublisherOpen.value = false
  newRoleOpen.value = true
}

// Kinds the backend can emit (catalog/entries.py). `unknown` is a fallback
// bucket, not a useful filter facet, so it is intentionally omitted here.
const KINDS = ['lab', 'gamenet', 'component', 'container', 'ansible_role']
const DIFFICULTIES = ['easy', 'medium', 'hard']

// A source is read-only when its write-access probe came back explicitly false.
// Used to visibly flag (and gate) the customize/fork-and-edit action per tile.
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

function toggleKind(kind) {
  const i = selectedKinds.value.indexOf(kind)
  if (i >= 0) selectedKinds.value.splice(i, 1)
  else selectedKinds.value.push(kind)
}

function toggleSource(id) {
  const i = selectedSources.value.indexOf(id)
  if (i >= 0) selectedSources.value.splice(i, 1)
  else selectedSources.value.push(id)
}

function clearFilters() {
  selectedKinds.value = []
  selectedSources.value = []
  selectedOs.value = ''
  selectedDifficulty.value = ''
  tagInput.value = ''
  searchQuery.value = ''
}

// The composable follows backend pages; filters use the resulting full set.
async function refresh() {
  await catalog.listEntries({ limit: 500 })
}

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
  router.push(`/project/${project.id}?tab=${project.catalogRef?.kind === 'ansible_role' ? 'config' : 'canvas'}`)
}

function openFork(entry) {
  handoff.value = { entry, mode: 'customize', publish: true }
}
</script>

<template>
  <CatalogProjectHandoff v-if="handoff" :key="`${handoff.entry.source_id}:${handoff.entry.path}:${handoff.mode}`"
    :entry="handoff.entry" :mode="handoff.mode" :publish-after-import="handoff.publish" @close="handoff = null" @opened="openCreatedProject" />
  <CatalogAppendDialog v-if="addition" :entry="addition" :initial-project-id="targetProjectId" :initial-node-id="targetNodeId" @close="addition = null" @added="onAdded" />
  <section class="max-w-7xl mx-auto p-4 sm:p-6">
    <header class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('catalog.title') }}</h1>
        <p class="text-sm text-base-content/70 mt-1">{{ t('catalog.subtitle') }}</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm shrink-0" data-testid="new-catalog-role" @click="openNewRole">{{ t('catalog.new_role') }}</button>
    </header>
    <div v-if="targetProject" class="rounded-xl border border-primary/25 bg-primary/5 p-4 mb-5 flex flex-wrap items-center justify-between gap-3" data-testid="catalog-project-context">
      <div class="min-w-0"><p class="font-medium break-words">{{ t('catalog.append.context', { project: targetProject.name }) }}</p><p class="text-sm text-base-content/70 mt-1">{{ t('catalog.append.context_hint') }}</p></div>
      <RouterLink class="btn btn-outline btn-sm" :to="{ path: `/project/${targetProject.id}`, query: { tab: 'canvas', ...(targetNodeId ? { node: targetNodeId } : {}) } }">{{ t('catalog.append.return_project') }}</RouterLink>
    </div>
    <p v-else-if="targetProjectId" role="alert" class="alert alert-warning mb-4">{{ t('catalog.append.missing_project') }}</p>
    <p v-if="addedMessage" role="status" class="alert alert-success mb-4">{{ addedMessage }}</p>

    <NewRoleModal :key="roleDraftId" :open="newRoleOpen" @close="newRoleOpen = false" @prepared="publishRole" />
    <PublishTargetsModal
      v-if="roleDraft"
      :open="rolePublisherOpen"
      :project-id="roleDraftId"
      :files="roleDraft.files"
      :message="`Add Ansible role ${roleDraft.name}`"
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
        <div>
          <p id="catalog-kind-label" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.kind') }}</p>
          <div class="flex flex-wrap gap-1 mt-1" role="group" aria-labelledby="catalog-kind-label">
            <button
              v-for="k in KINDS"
              :key="k"
              type="button"
              class="btn btn-xs"
              :class="selectedKinds.includes(k) ? 'btn-primary' : 'btn-ghost'"
              :aria-pressed="selectedKinds.includes(k)"
              @click="toggleKind(k)"
            >
              {{ k.replace(/_/g, ' ') }}
            </button>
          </div>
        </div>

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

        <div class="md:col-span-2">
          <label for="catalog-tags" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.tags') }}</label>
          <input
            id="catalog-tags" name="tags" autocomplete="off"
            v-model="tagInput"
            type="text"
            class="input input-bordered input-sm w-full mt-1"
            placeholder="tag1, tag2"
          />
        </div>

        <div class="md:col-span-2">
          <label for="catalog-search" class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.search') }}</label>
          <input
            id="catalog-search" name="search" autocomplete="off"
            v-model="searchQuery"
            type="search"
            class="input input-bordered input-sm w-full mt-1"
            :placeholder="t('catalog.filters.search')"
          />
        </div>

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
          v-for="entry in entriesView"
          :key="`${entry.source_id}:${entry.path}`"
          class="relative"
        >
          <CatalogTile
            :entry="entry"
            :source-readonly="isSourceReadonly(entry.source_id)"
            :project-id="targetProjectId"
            :node-id="targetNodeId"
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
    </template>

  </section>
</template>

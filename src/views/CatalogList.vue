<script setup>
import { randomId } from '@/services/randomId'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCatalog, applyClientFilters } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogTile from '@/components/ui/CatalogTile.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import NewRoleModal from '@/components/catalog/NewRoleModal.vue'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import { ensureNamespaces } from '@/i18n'

const { t } = useI18n()
const router = useRouter()
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

// Fetch the full entry set; a generous limit avoids silently truncating
// catalogs. Real pagination is deferred (TODO) — acceptable while catalogs are
// small. Filtering happens entirely client-side in `entriesView`, so there is
// no per-filter refetch.
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
  <section class="max-w-6xl mx-auto p-6">
    <header class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('catalog.title') }}</h1>
        <p class="text-sm text-base-content/70 mt-1">{{ t('catalog.subtitle') }}</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm shrink-0" data-testid="new-catalog-role" @click="openNewRole">{{ t('catalog.new_role') }}</button>
    </header>

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
          <label class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.kind') }}</label>
          <div class="flex flex-wrap gap-1 mt-1">
            <button
              v-for="k in KINDS"
              :key="k"
              type="button"
              class="btn btn-xs"
              :class="selectedKinds.includes(k) ? 'btn-primary' : 'btn-ghost'"
              @click="toggleKind(k)"
            >
              {{ k.replace(/_/g, ' ') }}
            </button>
          </div>
        </div>

        <div>
          <label class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.source') }}</label>
          <div class="flex flex-wrap gap-1 mt-1">
            <button
              v-for="s in inv.sources"
              :key="s.id"
              type="button"
              class="btn btn-xs"
              :class="selectedSources.includes(s.id) ? 'btn-primary' : 'btn-ghost'"
              @click="toggleSource(s.id)"
            >
              {{ s.name || s.id }}
            </button>
          </div>
        </div>

        <div>
          <label class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.os') }}</label>
          <input
            v-model="selectedOs"
            type="text"
            class="input input-bordered input-sm w-full mt-1"
            :placeholder="t('catalog.filters.os_any')"
          />
        </div>

        <div>
          <label class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.difficulty') }}</label>
          <select v-model="selectedDifficulty" class="select select-bordered select-sm w-full mt-1">
            <option value="">{{ t('catalog.filters.difficulty_any') }}</option>
            <option v-for="d in DIFFICULTIES" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>

        <div class="md:col-span-2">
          <label class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.tags') }}</label>
          <input
            v-model="tagInput"
            type="text"
            class="input input-bordered input-sm w-full mt-1"
            placeholder="tag1, tag2"
          />
        </div>

        <div class="md:col-span-2">
          <label class="text-xs font-semibold text-base-content/60">{{ t('catalog.filters.search') }}</label>
          <input
            v-model="searchQuery"
            type="search"
            class="input input-bordered input-sm w-full mt-1"
            :placeholder="t('catalog.filters.search')"
          />
        </div>

        <div class="md:col-span-4 flex justify-end">
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
          <span
            v-if="isSourceReadonly(entry.source_id)"
            class="badge badge-ghost badge-sm absolute top-3 right-3 z-10"
            data-testid="tile-readonly-badge"
            :title="t('catalog.verbs.customize_readonly_hint')"
          >
            {{ t('sources.access_readonly') }}
          </span>
          <CatalogTile
            :entry="entry"
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

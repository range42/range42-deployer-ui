<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCatalog, applyClientFilters } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { getProvider } from '@/services/git'
import CatalogTile from '@/components/ui/CatalogTile.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
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

// Fork modal state
const forkEntry = ref(null)
const forkTargetRepo = ref('')
const forkTargetName = ref('')
const forkBusy = ref(false)
const forkError = ref('')

// Kinds the backend can emit (catalog/entries.py). `unknown` is a fallback
// bucket, not a useful filter facet, so it is intentionally omitted here.
const KINDS = ['lab', 'gamenet', 'component', 'container', 'ansible_role']
const DIFFICULTIES = ['easy', 'medium', 'hard']

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

function useEntry(entry) {
  const p = projects.createProject(entry.name)
  projects.updateProject(p.id, {
    catalogRef: {
      mode: 'use',
      source_id: entry.source_id,
      path: entry.path,
      sha: entry.sha,
    },
  })
  router.push(`/project/${p.id}?tab=canvas`)
}

function customizeEntry(entry) {
  const p = projects.createProject(`${entry.name} (custom)`)
  projects.updateProject(p.id, {
    catalogRef: {
      mode: 'customize',
      source_id: entry.source_id,
      path: entry.path,
      sha: entry.sha,
    },
  })
  router.push(`/project/${p.id}?tab=canvas`)
}

function openFork(entry) {
  forkEntry.value = entry
  forkTargetRepo.value = ''
  forkTargetName.value = entry.name
  forkError.value = ''
}

function closeFork() {
  forkEntry.value = null
  forkTargetRepo.value = ''
  forkTargetName.value = ''
  forkError.value = ''
  forkBusy.value = false
}

async function submitFork() {
  forkError.value = ''
  const entry = forkEntry.value
  if (!entry || !forkTargetRepo.value || !forkTargetName.value) {
    forkError.value = 'Missing target repo or name'
    return
  }
  forkBusy.value = true
  try {
    const m = forkTargetRepo.value.trim().match(/^([^/]+)\/([^/]+)$/)
    if (!m) throw new Error('Target must be owner/repo')
    const [, owner, repo] = m
    const source = inv.getSource(entry.source_id)
    const kind = source?.provider || 'gitlab'
    const branch = `catalog/${forkTargetName.value.replace(/\s+/g, '-').toLowerCase()}`
    try {
      const prov = getProvider(kind, {
        baseUrl: source?.base_url,
        token: inv.getToken(entry.source_id),
      })
      await prov.createBranch({
        owner,
        repo,
        from: 'main',
        name: branch,
      })
      const seed = `name: ${forkTargetName.value}\nkind: ${entry.kind}\nfrom:\n  source_id: ${entry.source_id}\n  path: ${entry.path}\n`
      await prov.putFile({
        owner,
        repo,
        path: 'range42.yaml',
        content: seed,
        message: `seed ${forkTargetName.value} from ${entry.source_id}/${entry.path}`,
        branch,
      })
    } catch (e) {
      // provider may not be implemented (e.g. github v1) — proceed to navigate
      console.warn('[catalog] fork provider call failed:', e)
    }
    const newSourceId = `${kind}:${owner}/${repo}`
    router.push(`/catalog/${encodeURIComponent(newSourceId)}/${encodeURIComponent('range42.yaml')}`)
    closeFork()
  } catch (err) {
    forkError.value = err?.message || String(err)
  } finally {
    forkBusy.value = false
  }
}
</script>

<template>
  <section class="max-w-6xl mx-auto p-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold">{{ t('catalog.title') }}</h1>
      <p class="text-sm text-base-content/70 mt-1">{{ t('catalog.subtitle') }}</p>
    </header>

    <!-- Empty state when no sources -->
    <div v-if="inv.sources.length === 0">
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
        v-if="loadError && entriesView.length === 0"
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
        <CatalogTile
          v-for="entry in entriesView"
          :key="`${entry.source_id}:${entry.path}`"
          :entry="entry"
          @use="useEntry"
          @customize="customizeEntry"
          @fork="openFork"
        />
      </div>
      <div v-else-if="!loading">
        <EmptyState
          :title="t('catalog.empty.no_entries_title')"
          :description="t('catalog.empty.no_entries_desc')"
        />
      </div>
    </template>

    <!-- Fork modal -->
    <div v-if="forkEntry" class="modal modal-open" role="dialog" aria-modal="true">
      <div class="modal-box max-w-md">
        <h3 class="font-bold text-lg mb-3">{{ t('catalog.detail.fork_modal_title') }}</h3>
        <label class="form-control mb-3">
          <span class="label label-text">{{ t('catalog.detail.fork_target_repo') }}</span>
          <input v-model="forkTargetRepo" type="text" class="input input-bordered" placeholder="owner/repo" />
        </label>
        <label class="form-control mb-3">
          <span class="label label-text">{{ t('catalog.detail.fork_target_name') }}</span>
          <input v-model="forkTargetName" type="text" class="input input-bordered" />
        </label>
        <p v-if="forkError" class="text-error text-sm">{{ forkError }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" :disabled="forkBusy" @click="closeFork">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="forkBusy || !forkTargetRepo || !forkTargetName"
            @click="submitFork"
          >
            {{ t('catalog.detail.fork_submit') }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeFork" />
    </div>
  </section>
</template>

<script setup>
/**
 * CatalogEntryDetail — full-page entry viewer for `/catalog/:source/:entry`.
 *
 * Fetches a single catalog entry via `useCatalog().getEntry(source, path)`
 * and renders:
 *   - Header (name, kind badge, source + sha pill, updated_at)
 *   - README preview (plain-text; rich markdown can be layered later)
 *   - Topology preview (read-only VueFlow when `entry.topology.nodes/edges` exist)
 *   - Metadata table
 *   - Attachment inventory list
 *   - Three verb buttons: Use, Customize, Fork & publish
 *
 * Plan C §4 (Task C2.7).
 */

import { ref, computed, onMounted, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'

import { useCatalog } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { getProvider } from '@/services/git'
import { ensureNamespaces } from '@/i18n'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const catalog = useCatalog()
const inv = useInventoryStore()
const projects = useProjectStore()

const entry = ref(null)
const loading = ref(false)
const loadError = ref('')

const sourceParam = computed(() => String(route.params.source || ''))
const entryParam = computed(() => String(route.params.entry || ''))

const kindBadgeClass = computed(() => {
  switch (entry.value?.kind) {
    case 'lab':
      return 'badge-primary'
    case 'gamenet':
      return 'badge-secondary'
    case 'component':
      return 'badge-accent'
    default:
      return 'badge-ghost'
  }
})

// Topology preview (VueFlow read-only) — only if the entry carries nodes/edges.
const topologyNodes = computed(() => {
  const nodes = entry.value?.topology?.nodes
  return Array.isArray(nodes) ? nodes.map((n) => markRaw({ ...n })) : []
})
const topologyEdges = computed(() => {
  const edges = entry.value?.topology?.edges
  return Array.isArray(edges) ? edges.map((e) => markRaw({ ...e })) : []
})
const hasTopology = computed(
  () => topologyNodes.value.length > 0 || topologyEdges.value.length > 0,
)

// Metadata table rows — shallow key/value from entry.metadata (+ a few known fields).
const metadataRows = computed(() => {
  const rows = []
  const e = entry.value
  if (!e) return rows
  if (e.os) rows.push({ key: 'os', value: String(e.os) })
  if (e.difficulty) rows.push({ key: 'difficulty', value: String(e.difficulty) })
  if (Array.isArray(e.tags) && e.tags.length) {
    rows.push({ key: 'tags', value: e.tags.join(', ') })
  }
  if (e.metadata && typeof e.metadata === 'object') {
    for (const [k, v] of Object.entries(e.metadata)) {
      rows.push({
        key: k,
        value: typeof v === 'object' ? JSON.stringify(v) : String(v),
      })
    }
  }
  return rows
})

const inventoryItems = computed(() => {
  const inv = entry.value?.inventory
  return Array.isArray(inv) ? inv : []
})

const shortSha = computed(() => {
  const sha = entry.value?.sha
  return sha ? String(sha).slice(0, 7) : ''
})

// ---------- Fork modal ----------
const forkOpen = ref(false)
const forkTargetRepo = ref('')
const forkTargetName = ref('')
const forkBusy = ref(false)
const forkError = ref('')

function openFork() {
  forkOpen.value = true
  forkTargetRepo.value = ''
  forkTargetName.value = entry.value?.name || ''
  forkError.value = ''
}

function closeFork() {
  forkOpen.value = false
  forkBusy.value = false
}

async function submitFork() {
  forkError.value = ''
  const current = entry.value
  if (!current || !forkTargetRepo.value || !forkTargetName.value) {
    forkError.value = 'Missing target repo or name'
    return
  }
  forkBusy.value = true
  try {
    const m = forkTargetRepo.value.trim().match(/^([^/]+)\/([^/]+)$/)
    if (!m) throw new Error('Target must be owner/repo')
    const [, owner, repo] = m
    const source = inv.getSource(current.source_id)
    const kind = source?.provider || 'gitlab'
    const branch = `catalog/${forkTargetName.value
      .replace(/\s+/g, '-')
      .toLowerCase()}`
    try {
      const prov = getProvider(kind, {
        baseUrl: source?.base_url,
        token: inv.getToken(current.source_id),
      })
      await prov.createBranch({ owner, repo, from: 'main', name: branch })
      const seed =
        `name: ${forkTargetName.value}\n` +
        `kind: ${current.kind}\n` +
        `from:\n` +
        `  source_id: ${current.source_id}\n` +
        `  path: ${current.path}\n`
      await prov.putFile({
        owner,
        repo,
        path: 'range42.yaml',
        content: seed,
        message: `seed ${forkTargetName.value} from ${current.source_id}/${current.path}`,
        branch,
      })
    } catch (e) {
      console.warn('[catalog] fork provider call failed:', e)
    }
    const newSourceId = `${kind}:${owner}/${repo}`
    router.push(
      `/catalog/${encodeURIComponent(newSourceId)}/${encodeURIComponent('range42.yaml')}`,
    )
    closeFork()
  } catch (err) {
    forkError.value = err?.message || String(err)
  } finally {
    forkBusy.value = false
  }
}

// ---------- Verbs ----------
function useEntry() {
  if (!entry.value) return
  const p = projects.createProject(entry.value.name)
  projects.updateProject(p.id, {
    catalogRef: {
      mode: 'use',
      source_id: entry.value.source_id,
      path: entry.value.path,
      sha: entry.value.sha,
    },
  })
  router.push(`/project/${p.id}?tab=canvas`)
}

function customizeEntry() {
  if (!entry.value) return
  const p = projects.createProject(`${entry.value.name} (custom)`)
  projects.updateProject(p.id, {
    catalogRef: {
      mode: 'customize',
      source_id: entry.value.source_id,
      path: entry.value.path,
      sha: entry.value.sha,
    },
  })
  router.push(`/project/${p.id}?tab=canvas`)
}

// ---------- Lifecycle ----------
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const got = await catalog.getEntry(sourceParam.value, entryParam.value)
    entry.value = got
    if (!got) loadError.value = catalog.error.value || 'Entry not found'
  } catch (e) {
    loadError.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await ensureNamespaces(['catalog', 'common'])
  await load()
})
</script>

<template>
  <section class="max-w-5xl mx-auto p-6">
    <!-- Back link -->
    <div class="mb-4">
      <button class="btn btn-ghost btn-sm gap-2" @click="router.push('/catalog')">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        <span>{{ t('catalog.detail.back') }}</span>
      </button>
    </div>

    <!-- Loading / error -->
    <div v-if="loading" class="space-y-3" data-testid="entry-loading">
      <div class="skeleton h-8 w-1/2" />
      <div class="skeleton h-4 w-1/3" />
      <div class="skeleton h-40 w-full mt-4" />
    </div>

    <div v-else-if="!entry" class="alert alert-warning" role="alert">
      <span class="text-sm">{{ loadError || t('catalog.empty.no_entries_title') }}</span>
    </div>

    <template v-else>
      <!-- Header -->
      <header class="mb-6">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h1 class="text-2xl font-semibold truncate">{{ entry.name }}</h1>
              <span class="badge" :class="kindBadgeClass">{{ entry.kind }}</span>
            </div>
            <p class="text-sm text-base-content/60 truncate">
              {{ entry.source_id }} · {{ entry.path }}
              <span v-if="shortSha" class="ml-1 badge badge-ghost badge-sm font-mono">
                {{ shortSha }}
              </span>
            </p>
            <p
              v-if="entry.updated_at"
              class="text-xs text-base-content/50 mt-1"
            >
              {{ t('catalog.detail.updated') }}: {{ entry.updated_at }}
            </p>
          </div>

          <!-- Verbs -->
          <div class="flex items-center gap-2 flex-wrap" data-testid="entry-verbs">
            <button type="button" class="btn btn-primary btn-sm" @click="useEntry">
              {{ t('catalog.verbs.use') }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="customizeEntry">
              {{ t('catalog.verbs.customize') }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="openFork">
              {{ t('catalog.verbs.fork') }}
            </button>
          </div>
        </div>

        <p
          v-if="entry.description"
          class="text-sm text-base-content/70 mt-3 max-w-prose"
        >
          {{ entry.description }}
        </p>
      </header>

      <!-- README preview -->
      <section class="mb-8" data-testid="entry-readme">
        <h2 class="text-lg font-semibold mb-2">{{ t('catalog.detail.readme') }}</h2>
        <div
          v-if="entry.readme"
          class="card card-bordered bg-base-100 p-4 overflow-auto max-h-[40vh]"
        >
          <pre class="text-sm whitespace-pre-wrap font-mono leading-relaxed">{{ entry.readme }}</pre>
        </div>
        <p v-else class="text-sm text-base-content/60 italic">—</p>
      </section>

      <!-- Topology preview -->
      <section v-if="hasTopology" class="mb-8" data-testid="entry-topology">
        <h2 class="text-lg font-semibold mb-2">{{ t('catalog.detail.topology') }}</h2>
        <div class="card card-bordered bg-base-100 h-80">
          <VueFlow
            :nodes="topologyNodes"
            :edges="topologyEdges"
            :nodes-draggable="false"
            :nodes-connectable="false"
            :elements-selectable="false"
            :zoom-on-scroll="false"
            :zoom-on-double-click="false"
            :pan-on-drag="true"
            fit-view-on-init
            class="rounded-lg"
          >
            <Background />
          </VueFlow>
        </div>
      </section>

      <!-- Metadata table -->
      <section v-if="metadataRows.length" class="mb-8" data-testid="entry-metadata">
        <h2 class="text-lg font-semibold mb-2">{{ t('catalog.detail.metadata') }}</h2>
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <tbody>
              <tr v-for="row in metadataRows" :key="row.key">
                <th class="font-medium text-base-content/70 w-48">{{ row.key }}</th>
                <td class="font-mono text-sm break-all">{{ row.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Attachment inventory -->
      <section v-if="inventoryItems.length" class="mb-8" data-testid="entry-inventory">
        <h2 class="text-lg font-semibold mb-2">{{ t('catalog.detail.inventory') }}</h2>
        <ul class="menu bg-base-200/40 rounded-lg">
          <li v-for="(item, idx) in inventoryItems" :key="idx">
            <div class="flex items-center gap-3">
              <span class="badge badge-ghost badge-sm">{{ item.kind || 'file' }}</span>
              <span class="font-mono text-sm truncate">{{ item.path || item.name }}</span>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <!-- Fork modal -->
    <div v-if="forkOpen" class="modal modal-open" role="dialog" aria-modal="true">
      <div class="modal-box max-w-md">
        <h3 class="font-bold text-lg mb-3">
          {{ t('catalog.detail.fork_modal_title') }}
        </h3>
        <label class="form-control mb-3">
          <span class="label label-text">{{ t('catalog.detail.fork_target_repo') }}</span>
          <input
            v-model="forkTargetRepo"
            type="text"
            class="input input-bordered"
            placeholder="owner/repo"
          />
        </label>
        <label class="form-control mb-3">
          <span class="label label-text">{{ t('catalog.detail.fork_target_name') }}</span>
          <input v-model="forkTargetName" type="text" class="input input-bordered" />
        </label>
        <p v-if="forkError" class="text-error text-sm">{{ forkError }}</p>
        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="forkBusy"
            @click="closeFork"
          >
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

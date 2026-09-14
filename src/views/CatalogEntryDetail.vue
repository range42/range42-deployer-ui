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

import { ref, computed, onMounted, markRaw, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'

import { useCatalog } from '@/composables/useCatalog'
import { useBackendApiStore } from '@/stores/backendApiStore'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogAppendDialog from '@/components/catalog/CatalogAppendDialog.vue'
import { ensureNamespaces } from '@/i18n'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const catalog = useCatalog()
const backend = useBackendApiStore()

const entry = ref(null)
const loading = ref(false)
const loadError = ref('')
const addition = ref(false)
const addedMessage = ref('')
const targetProjectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const targetNodeId = computed(() => typeof route.query.node === 'string' ? route.query.node : '')
const contextQuery = computed(() => targetProjectId.value ? { project: targetProjectId.value, ...(targetNodeId.value ? { node: targetNodeId.value } : {}) } : {})
function onAdded(result) {
  addition.value = false
  if (result.open) router.push({ path: `/project/${result.projectId}`, query: { tab: result.tab,
    ...(result.nodeId ? { node: result.nodeId } : {}), ...(result.file ? { file: result.file } : {}) } })
  else { addedMessage.value = t('catalog.append.added_short'); router.replace({ query: { ...route.query, project: result.projectId } }) }
}

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

// ---------- Verbs ----------
const handoff = ref(null)
function useEntry() {
  handoff.value = { entry: entry.value, mode: 'use' }
}
function customizeEntry() {
  handoff.value = { entry: entry.value, mode: 'customize' }
}
function openCreatedProject(project) {
  handoff.value = null
  router.push(`/project/${project.id}?tab=${project.catalogRef?.kind === 'ansible_role' ? 'config' : 'canvas'}`)
}

function openFork() {
  handoff.value = { entry: entry.value, mode: 'customize', publish: true }
}

// ---------- Lifecycle ----------
async function load() {
  const current = ++loadGeneration
  handoff.value = null; addition.value = false
  loading.value = true
  entry.value = null
  loadError.value = ''
  try {
    const got = await catalog.getEntry(sourceParam.value, entryParam.value)
    if (current !== loadGeneration) return
    entry.value = got
    if (!got) loadError.value = catalog.error.value || 'Entry not found'
  } catch (e) {
    if (current === loadGeneration) loadError.value = e?.message || String(e)
  } finally {
    if (current === loadGeneration) loading.value = false
  }
}
let loadGeneration = 0
watch([sourceParam, entryParam, () => backend.url, () => backend.token], () => load())
onBeforeUnmount(() => { loadGeneration += 1 })

onMounted(async () => {
  await ensureNamespaces(['catalog', 'common'])
  await load()
})
</script>

<template>
  <CatalogProjectHandoff v-if="handoff" :key="`${handoff.entry.source_id}:${handoff.entry.path}:${handoff.mode}`"
    :entry="handoff.entry" :mode="handoff.mode" :publish-after-import="handoff.publish" @close="handoff = null" @opened="openCreatedProject" />
  <CatalogAppendDialog v-if="addition && entry" :entry="entry" :initial-project-id="targetProjectId" :initial-node-id="targetNodeId" @close="addition = false" @added="onAdded" />
  <section class="max-w-5xl mx-auto p-4 sm:p-6">
    <!-- Back link -->
    <div class="mb-4">
      <RouterLink class="btn btn-ghost btn-sm gap-2" :to="{ path: '/catalog', query: contextQuery }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        <span>{{ t('catalog.detail.back') }}</span>
      </RouterLink>
    </div>
    <p v-if="addedMessage" role="status" class="alert alert-success mb-4">{{ addedMessage }}</p>

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
            <button type="button" class="btn btn-primary btn-sm" data-testid="catalog-add-to-project" @click="addition = true">{{ t('catalog.append.action') }}</button>
            <button type="button" class="btn btn-outline btn-sm" @click="useEntry">
              {{ t('catalog.verbs.use') }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="customizeEntry"
            >
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

  </section>
</template>

<script setup>
/**
 * CatalogEntryDetail — full-page entry viewer for `/catalog/:source/:entry`.
 *
 * Fetches a single catalog entry via `useCatalog().getEntry(source, path)`
 * and renders:
 *   - Header (name, kind badge, source + sha pill, updated_at)
 *   - README preview (Markdown with source HTML disabled)
 *   - Topology preview (read-only VueFlow when `entry.topology.nodes/edges` exist)
 *   - Metadata table
 *   - Attachment inventory list
 *   - Actions supported by the item kind and source availability
 *
 * Plan C §4 (Task C2.7).
 */

import { ref, computed, onMounted, markRaw, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'

import { useCatalog } from '@/composables/useCatalog'
import { useProjectStore } from '@/stores/projectStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import CatalogProjectHandoff from '@/components/catalog/CatalogProjectHandoff.vue'
import CatalogAppendDialog from '@/components/catalog/CatalogAppendDialog.vue'
import CatalogReadme from '@/components/catalog/CatalogReadme.vue'
import { ensureNamespaces } from '@/i18n'
import { useCatalogSourceAccess } from '@/composables/useCatalogSourceAccess'
import { catalogBrowseQuery, catalogCapabilities } from '@/services/catalogPresentation'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const catalog = useCatalog()
const backend = useBackendApiStore()
const sourceAccess = useCatalogSourceAccess()
const projects = useProjectStore()
const inventory = useInventoryStore()
const sourceName = computed(() => inventory.getSource(entry.value?.source_id)?.name || entry.value?.source_id)
const sourceError = sourceAccess.error
const capabilities = computed(() => catalogCapabilities(entry.value?.kind || ''))

const entry = ref(null)
const loading = ref(false)
const loadError = ref('')
const addition = ref(false)
const addedMessage = ref('')
const targetProjectId = computed(() => typeof route.query.project === 'string' ? route.query.project : '')
const targetNodeId = computed(() => typeof route.query.node === 'string' ? route.query.node : '')
const contextQuery = computed(() => ({ ...catalogBrowseQuery(route.query), ...(targetProjectId.value ? { project: targetProjectId.value, ...(targetNodeId.value ? { node: targetNodeId.value } : {}) } : {}) }))
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
  return Array.isArray(nodes) ? nodes.map((n) => markRaw({ ...n, type: 'default', label: n.data?.label || n.id, data: { ...n.data, catalogType: n.type } })) : []
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

const nodeSummary = computed(() => topologyNodes.value.map(node => ({
  id: node.id, name: node.data?.label || node.id, kind: node.data?.catalogType || 'vm', config: node.data?.config || {},
})))
const requirementKey = computed(() => ['container', 'ansible_role'].includes(entry.value?.kind) ? entry.value.kind : capabilities.value.create ? 'topology' : 'unsupported')
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
  projects.loadProjects()
  await ensureNamespaces(['catalog', 'common'])
  await load()
})
</script>

<template>
  <CatalogProjectHandoff v-if="handoff" :key="`${handoff.entry.source_id}:${handoff.entry.path}:${handoff.mode}`"
    :entry="handoff.entry" :mode="handoff.mode" :publish-after-import="handoff.publish" @close="handoff = null" @opened="openCreatedProject" />
  <CatalogAppendDialog v-if="addition && entry" :entry="entry" :initial-project-id="targetProjectId" :initial-node-id="targetNodeId" @close="addition = false" @added="onAdded" />
  <section class="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
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
    <div v-if="sourceError" class="alert alert-warning mb-4" role="alert" data-testid="catalog-source-error">
      <span class="text-sm break-words">{{ sourceError }}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-testid="catalog-source-retry" @click="sourceAccess.reload">{{ t('common.retry') }}</button>
    </div>

    <!-- Loading / error -->
    <div v-if="loading" class="space-y-3" data-testid="entry-loading">
      <div class="skeleton h-8 w-1/2" />
      <div class="skeleton h-4 w-1/3" />
      <div class="skeleton h-40 w-full mt-4" />
    </div>

    <div v-else-if="!entry" class="alert alert-warning" role="alert">
      <span class="text-sm">{{ loadError || t('catalog.empty.no_entries_title') }}</span>
      <button type="button" class="btn btn-sm btn-ghost" @click="load">{{ t('common.retry') }}</button>
    </div>

    <template v-else>
      <!-- Header -->
      <header class="mb-6 rounded-2xl border border-base-300 bg-base-100 p-5 sm:p-6">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <h1 class="text-2xl font-semibold break-words">{{ entry.name }}</h1>
              <span class="badge" :class="kindBadgeClass">{{ t(`catalog.kinds.${capabilities.append ? entry.kind : 'unknown'}`) }}</span>
            </div>
            <p class="text-sm text-base-content/60 truncate">
              {{ sourceName }}
              <span v-if="shortSha" class="ml-1 badge badge-ghost badge-sm font-mono">
                {{ shortSha }}
              </span>
            </p>
            <p
              v-if="entry.updated_at"
              class="text-xs text-base-content/50 mt-1"
            >
              {{ t('catalog.detail.updated') }}: {{ Number.isNaN(Date.parse(entry.updated_at)) ? entry.updated_at : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(entry.updated_at)) }}
            </p>
          </div>

          <!-- Verbs -->
          <div class="flex items-center gap-2 flex-wrap" data-testid="entry-verbs">
            <button v-if="capabilities.append" type="button" class="btn btn-primary btn-sm" data-testid="catalog-add-to-project" :disabled="!sourceAccess.available(entry.source_id)" @click="addition = true">{{ t('catalog.append.action') }}</button>
            <button v-if="capabilities.create" type="button" class="btn btn-outline btn-sm" :disabled="!sourceAccess.available(entry.source_id)" @click="useEntry">
              {{ t('catalog.verbs.use') }}
            </button>
            <details v-if="capabilities.create" class="dropdown dropdown-end">
              <summary class="btn btn-ghost btn-sm">{{ t('catalog.more_actions') }}</summary>
              <ul class="dropdown-content menu z-10 mt-2 w-52 rounded-xl border border-base-300 bg-base-100 p-2 shadow-lg">
                <li><button type="button" :disabled="!sourceAccess.available(entry.source_id)" @click="customizeEntry">{{ t('catalog.verbs.customize') }}</button></li>
                <li><button type="button" :disabled="!sourceAccess.available(entry.source_id)" @click="openFork">{{ t('catalog.verbs.fork') }}</button></li>
              </ul>
            </details>
          </div>
        </div>

        <p
          v-if="entry.description"
          class="text-sm text-base-content/70 mt-3 max-w-prose"
        >
          {{ entry.description }}
        </p>
      </header>

      <section class="mb-6 rounded-2xl bg-base-200/50 p-5 sm:p-6" data-testid="entry-requirements">
        <h2 class="text-base font-semibold">{{ t('catalog.detail.before_use') }}</h2>
        <p class="mt-2 text-sm text-base-content/75 leading-relaxed">{{ t(`catalog.requirements.${requirementKey}`) }}</p>
        <ul v-if="nodeSummary.length" class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="node in nodeSummary" :key="node.id" class="min-w-0 rounded-xl border border-base-300 bg-base-100 p-4">
            <p class="font-medium break-words">{{ node.name }} <span class="badge badge-ghost badge-sm">{{ node.kind }}</span></p>
            <dl v-if="node.kind === 'vm'" class="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt class="text-base-content/65">{{ t('catalog.append.fields.cores') }}</dt><dd>{{ node.config.cores ?? '—' }}</dd>
              <dt class="text-base-content/65">{{ t('catalog.append.fields.memory') }}</dt><dd>{{ node.config.memory ?? node.config.memory_mb ?? '—' }}</dd>
              <dt class="text-base-content/65">{{ t('catalog.append.fields.diskSize') }}</dt><dd>{{ node.config.diskSize ?? node.config.disk_gb ?? '—' }}</dd>
              <dt class="text-base-content/65">{{ t('catalog.append.fields.template') }}</dt><dd>{{ node.config.template ?? t('catalog.detail.select_locally') }}</dd>
            </dl>
          </li>
        </ul>
      </section>

      <!-- README uses the shared HTML-disabled Markdown renderer. -->
      <section class="mb-8" data-testid="entry-readme">
        <h2 class="text-lg font-semibold mb-2">{{ t('catalog.detail.readme') }}</h2>
        <CatalogReadme v-if="entry.readme" :source="entry.readme" />
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
      <details class="mb-8 rounded-xl border border-base-300 p-4" data-testid="entry-metadata">
        <summary class="cursor-pointer font-semibold">{{ t('catalog.detail.metadata') }}</summary>
        <dl class="mt-4 mb-4 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt class="text-base-content/65">{{ t('catalog.detail.source') }}</dt><dd class="break-all">{{ sourceName }} · {{ entry.path }}</dd>
          <dt class="text-base-content/65">{{ t('catalog.detail.revision') }}</dt><dd class="font-mono break-all">{{ entry.sha || '—' }}</dd>
        </dl>
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
      </details>

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

/**
 * useCatalog — Cross-source catalog composable.
 *
 * Fetches catalog entries from the Range42 backend (`/v1/catalog/entries`)
 * and caches them in IndexedDB keyed by `source:sha` so subsequent tile-grid
 * renders are fast. Ported from Plan C §4.
 */

import { ref } from 'vue'
import { openDB, type IDBPDatabase } from 'idb'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { deserializeToCanvas } from '@/overlay/serialize'
import type { CatalogEntry as CatalogDocument } from '@/types/range42-schema'

// =============================================================================
// Types
// =============================================================================

/**
 * Server-side filters accepted by `GET /v1/catalog/entries`.
 *
 * These mirror exactly what the backend honors — `source_id`, `kind`, `tag`
 * (singular), `offset`, `limit`. Presentation-only refinement (os, difficulty,
 * free-text, multi-select) is applied client-side via {@link applyClientFilters}
 * so the API client stays a faithful mirror of the backend contract.
 */
export interface CatalogEntryFilters {
  kind?: string
  source_id?: string
  tag?: string
  offset?: number
  limit?: number
}

/** Kinds the backend can emit; see range42-backend-api catalog/entries.py. */
export type CatalogEntryKind =
  | 'lab'
  | 'gamenet'
  | 'component'
  | 'container'
  | 'ansible_role'
  | 'unknown'

export interface CatalogEntry {
  kind: CatalogEntryKind | string
  name: string
  description?: string
  tags?: string[]
  source_id: string
  path: string
  updated_at?: string
  difficulty?: string
  os?: string
  sha?: string
  readme?: string
  topology?: Record<string, unknown>
  inventory?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
  document?: Record<string, unknown>
  readme_md?: string | null
}

/** Adapt the API detail envelope to the fields rendered by the entry viewer. */
function presentEntry(entry: CatalogEntry): CatalogEntry {
  const doc = entry.document ?? {}
  const topology = Array.isArray(doc.nodes)
    ? { ...deserializeToCanvas(doc as unknown as CatalogDocument, { nodes: {}, edges: {}, unsupported: [] }) }
    : (doc.topology as CatalogEntry['topology']) ?? entry.topology
  return {
    ...entry,
    readme: entry.readme_md ?? entry.readme,
    topology,
    inventory: Array.isArray(doc.inventory) ? doc.inventory : entry.inventory,
    metadata: (doc.metadata as CatalogEntry['metadata']) ?? entry.metadata,
  }
}

/** Paged response envelope returned by the backend (`app.schemas.v1.common.Page`). */
export interface CatalogPage {
  items: CatalogEntry[]
  total: number
  offset: number
  limit: number
}

/** Presentation-side filters applied in the browser over fetched entries. */
export interface CatalogClientFilters {
  kinds?: string[]
  sources?: string[]
  tags?: string[]
  os?: string
  difficulty?: string
  q?: string
}

/**
 * Refine an already-fetched entry list in the browser. The backend only
 * filters by a single `source_id`/`kind`/`tag`, so multi-select and the
 * os/difficulty/free-text controls are resolved here. All dimensions combine
 * with AND; values within `kinds`/`sources` combine with OR; every tag in
 * `tags` must be present (AND).
 */
export function applyClientFilters(
  entries: CatalogEntry[] | null | undefined,
  filters: CatalogClientFilters = {},
): CatalogEntry[] {
  const { kinds, sources, tags, os, difficulty, q } = filters
  let out = entries ?? []
  if (kinds?.length) out = out.filter((e) => kinds.includes(e.kind))
  if (sources?.length) out = out.filter((e) => sources.includes(e.source_id))
  if (tags?.length) out = out.filter((e) => tags.every((tIdx) => (e.tags ?? []).includes(tIdx)))
  if (os) {
    const needle = os.toLowerCase()
    out = out.filter((e) => (e.os ?? '').toLowerCase() === needle)
  }
  if (difficulty) {
    const needle = difficulty.toLowerCase()
    out = out.filter((e) => (e.difficulty ?? '').toLowerCase() === needle)
  }
  if (q) {
    const needle = q.toLowerCase()
    out = out.filter((e) =>
      [e.name, e.description, e.path].some((s) => (s ?? '').toLowerCase().includes(needle)),
    )
  }
  return out
}

// =============================================================================
// IndexedDB wrapper
// =============================================================================

const DB_NAME = 'range42_catalog'
const DB_VERSION = 1
const STORE = 'catalog_cache'

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE)
        }
      },
    })
  }
  return dbPromise
}

function buildQueryString(filters: CatalogEntryFilters): string {
  const params = new URLSearchParams()
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return
    params.append(k, String(v))
  }
  // Only the parameters the backend actually filters on. Sending the legacy
  // `source`/`tags`/`os`/`difficulty`/`q` names was silently ignored server-side.
  put('kind', filters.kind)
  put('source_id', filters.source_id)
  put('tag', filters.tag)
  put('offset', filters.offset)
  put('limit', filters.limit)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function cacheKey(filters: CatalogEntryFilters): string {
  return `${getBackendScope()}:entries:${buildQueryString(filters)}`
}

// =============================================================================
// Composable
// =============================================================================

export function useCatalog() {
  const entries = ref<CatalogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function listEntries(filters: CatalogEntryFilters = {}): Promise<CatalogEntry[]> {
    loading.value = true
    error.value = null
    const key = cacheKey(filters)
    try {
      const collected: CatalogEntry[] = []
      let pageFilters = { ...filters }
      while (true) {
        const data = await backendRequest<CatalogPage>(
          `/v1/catalog/entries${buildQueryString(pageFilters)}`,
        )
        const items = data.items ?? []
        collected.push(...items)
        const offset = pageFilters.offset ?? 0
        const nextOffset = (data.offset ?? offset) + items.length
        if (!Number.isFinite(data.total) || nextOffset >= data.total) break
        if (!items.length || nextOffset <= offset) {
          throw new Error('Catalog pagination did not advance. Refresh the source and retry.')
        }
        pageFilters = { ...filters, offset: nextOffset }
      }
      entries.value = collected
      // Cache by filter key (the Page envelope carries no source SHA).
      try {
        const db = await getDb()
        // IndexedDB cannot clone Vue's reactive proxies; store the API payload.
        await db.put(STORE, { entries: collected, ts: Date.now() }, key)
      } catch {
        /* ignore cache failures */
      }
      return entries.value
    } catch (err) {
      // Fall back to cached data if available.
      try {
        const db = await getDb()
        const cached = await db.get(STORE, key)
        if (cached?.entries) {
          entries.value = cached.entries
          error.value = err instanceof Error ? err.message : String(err)
          return entries.value
        }
      } catch {
        /* ignore */
      }
      error.value = err instanceof Error ? err.message : String(err)
      entries.value = []
      return []
    } finally {
      loading.value = false
    }
  }

  async function getEntry(source: string, path: string): Promise<CatalogEntry | null> {
    loading.value = true
    error.value = null
    const key = `${getBackendScope()}:entry:${source}:${path}`
    try {
      const url = `/v1/catalog/entries/${encodeURIComponent(source)}/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      const entry = presentEntry(await backendRequest<CatalogEntry>(url))
      try {
        const db = await getDb()
        await db.put(STORE, { entry, ts: Date.now() }, key)
      } catch {
        /* ignore */
      }
      return entry
    } catch (err) {
      try {
        const db = await getDb()
        const cached = await db.get(STORE, key)
        if (cached?.entry) {
          error.value = err instanceof Error ? err.message : String(err)
          return cached.entry
        }
      } catch {
        /* ignore */
      }
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      loading.value = false
    }
  }

  async function clearCache(): Promise<void> {
    const db = await getDb()
    await db.clear(STORE)
  }

  return {
    entries,
    loading,
    error,
    listEntries,
    getEntry,
    clearCache,
  }
}

export default useCatalog

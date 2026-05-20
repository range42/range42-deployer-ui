/**
 * useCatalog — Cross-source catalog composable.
 *
 * Fetches catalog entries from the Range42 backend (`/v1/catalog/entries`)
 * and caches them in IndexedDB keyed by `source:sha` so subsequent tile-grid
 * renders are fast. Ported from Plan C §4.
 */

import { ref } from 'vue'
import { openDB, type IDBPDatabase } from 'idb'

// =============================================================================
// Types
// =============================================================================

export interface CatalogEntryFilters {
  kind?: string | string[]
  source?: string | string[]
  os?: string | string[]
  difficulty?: string | string[]
  tags?: string | string[]
  q?: string
}

export interface CatalogEntry {
  kind: 'lab' | 'gamenet' | 'component' | string
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
}

export interface CatalogListResponse {
  entries: CatalogEntry[]
  source_sha?: string
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
    if (Array.isArray(v)) {
      v.forEach((x) => params.append(k, String(x)))
    } else {
      params.append(k, String(v))
    }
  }
  put('kind', filters.kind)
  put('source', filters.source)
  put('os', filters.os)
  put('difficulty', filters.difficulty)
  put('tags', filters.tags)
  put('q', filters.q)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function cacheKey(filters: CatalogEntryFilters): string {
  return `entries:${buildQueryString(filters)}`
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
    const qs = buildQueryString(filters)
    const key = cacheKey(filters)
    try {
      const res = await fetch(`/v1/catalog/entries${qs}`, { credentials: 'same-origin' })
      if (!res.ok) {
        throw new Error(`catalog list failed: ${res.status}`)
      }
      const data = (await res.json()) as CatalogListResponse
      entries.value = data.entries || []
      // Cache by source_sha when available, else by filter key.
      try {
        const db = await getDb()
        const ck = data.source_sha ? `entries:${data.source_sha}` : key
        await db.put(STORE, { entries: entries.value, ts: Date.now() }, ck)
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
    const key = `entry:${source}:${path}`
    try {
      const url = `/v1/catalog/entries/${encodeURIComponent(source)}/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) {
        throw new Error(`catalog entry fetch failed: ${res.status}`)
      }
      const entry = (await res.json()) as CatalogEntry
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

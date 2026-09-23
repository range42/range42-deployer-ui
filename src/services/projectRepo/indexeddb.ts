/**
 * IndexedDB wrapper for project repo offline cache.
 *
 * Stores:
 *  - drafts          — latest autosaved ProjectState per projectId
 *  - pending_commits — autosave writes waiting to be pushed to git
 *  - catalog_cache   — catalog-entry lookups (populated by useCatalog)
 */
import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'range42-project-repo'
const DB_VERSION = 1

export interface DraftRecord {
  projectId: string
  state: unknown
  updatedAt: number
}

export interface PendingCommitRecord {
  id: string
  projectId: string
  branch: string
  path: string
  content: string
  message: string
  queuedAt: number
}

export interface CatalogCacheRecord {
  key: string
  value: unknown
  fetchedAt: number
}

let _dbPromise: Promise<IDBPDatabase> | null = null

export function openProjectDb(): Promise<IDBPDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'projectId' })
      }
      if (!db.objectStoreNames.contains('pending_commits')) {
        const store = db.createObjectStore('pending_commits', { keyPath: 'id' })
        store.createIndex('byProject', 'projectId')
      }
      if (!db.objectStoreNames.contains('catalog_cache')) {
        db.createObjectStore('catalog_cache', { keyPath: 'key' })
      }
    },
  })
  return _dbPromise
}

/** Test-only helper: reset the in-memory db promise cache. */
export function _resetProjectDbForTests(): void {
  _dbPromise = null
}

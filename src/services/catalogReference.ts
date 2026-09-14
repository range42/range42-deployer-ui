import { validateFilePath } from '@/services/projectFiles'

/** Public provenance is independent of the repository receiving project edits. */
export function publicCatalogReference(value: unknown): Record<string, string | number> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog origin')
  const origin = value as Record<string, unknown>
  if (!['use', 'customize'].includes(String(origin.mode)) || typeof origin.source_id !== 'string' || !origin.source_id
    || typeof origin.path !== 'string') throw new Error('Invalid catalog origin identity')
  if (origin.path !== '.') validateFilePath(origin.path)
  const result: Record<string, string | number> = { mode: String(origin.mode), source_id: origin.source_id, path: origin.path }
  for (const key of ['kind', 'sha', 'provider', 'base_url', 'repo_owner', 'repo_name', 'branch', 'backend_url']) {
    if (origin[key] !== undefined) {
      if (typeof origin[key] !== 'string') throw new Error(`Invalid catalog origin ${key}`)
      result[key] = origin[key]
    }
  }
  for (const key of ['base_url', 'backend_url']) {
    if (!result[key]) continue
    const url = new URL(String(result[key]))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Catalog origin URLs cannot contain credentials or query parameters')
  }
  if (origin.version === 1) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(String(result.sha))) throw new Error('Catalog origin requires an exact commit SHA')
    result.version = 1
  }
  return result
}

export interface CatalogImportReference {
  version: 1
  id: string
  origin: Record<string, string | number>
  node_ids: string[]
  attachment_ids: string[]
  content_ids: string[]
}

/** Append history is public provenance, never a provider credential or lease. */
export function publicCatalogImports(value: unknown): CatalogImportReference[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 1024) throw new Error('Invalid catalog append history')
  const ids = new Set<string>()
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid catalog append record')
    const row = raw as Record<string, unknown>
    if (row.version !== 1 || typeof row.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(row.id) || ids.has(row.id)) throw new Error('Invalid catalog append identity')
    ids.add(row.id)
    const origin = publicCatalogReference(row.origin)
    if (origin?.version !== 1) throw new Error('Catalog append requires exact source provenance')
    const references = (name: string) => {
      const entries = row[name]
      if (!Array.isArray(entries) || entries.length > 4096 || entries.some(id => typeof id !== 'string' || !id || id.length > 256)
        || new Set(entries).size !== entries.length) throw new Error(`Invalid catalog append ${name}`)
      return [...entries] as string[]
    }
    return { version: 1, id: row.id, origin, node_ids: references('node_ids'), attachment_ids: references('attachment_ids'), content_ids: references('content_ids') }
  })
}

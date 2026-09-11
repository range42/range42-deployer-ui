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

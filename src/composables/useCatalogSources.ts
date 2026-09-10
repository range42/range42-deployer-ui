import { ref } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useInventoryStore, type GitSource, type GitSourceRepo } from '@/stores/inventoryStore'

export const DEFAULT_CATALOG_URL = 'https://github.com/range42/range42-catalog'

export interface CatalogSourceInput {
  provider: GitSource['provider']
  base_url: string
  auth_kind: 'none' | 'pat'
  token_ref?: string
  repos: GitSourceRepo[]
}

interface CatalogSourceResponse {
  id: string
  provider: GitSource['provider']
  base_url: string
  auth_kind: GitSource['auth']['kind']
  has_token: boolean
  repos: GitSourceRepo[]
}

interface RefreshResult {
  source_id: string
  repos_seen: number
  entries_indexed: number
  finished_at: string
}

function normalizeSource(source: CatalogSourceResponse, scope: string): GitSource {
  const repos = source.repos ?? []
  return {
    id: source.id,
    provider: source.provider,
    base_url: source.base_url.replace(/\/+$/, ''),
    auth: { kind: source.auth_kind },
    repos,
    name: repos.map((repo) => `${repo.owner}/${repo.repo}`).join(', ') || source.base_url,
    backend_url: scope,
    has_token: source.has_token,
    ...(source.auth_kind === 'none' ? { writable: false } : {}),
  }
}

function assertSameBackend(scope: string): void {
  if (getBackendScope() !== scope) throw new Error('The selected backend changed. Reload sources and retry.')
}

/** Backend-owned catalog registrations. Tokens are sent once and never cached. */
export function useCatalogSources() {
  const inventory = useInventoryStore()
  const loading = ref(false)
  let loadVersion = 0

  function remember(source: CatalogSourceResponse, scope: string): GitSource {
    assertSameBackend(scope)
    const normalized = normalizeSource(source, scope)
    const current = inventory.sources.filter((item) => item.backend_url === scope && item.id !== source.id)
    inventory.syncSources([...current, normalized], scope)
    return normalized
  }

  async function loadSources(): Promise<void> {
    const scope = getBackendScope()
    const version = ++loadVersion
    loading.value = true
    try {
      const sources: CatalogSourceResponse[] = []
      let offset = 0
      while (true) {
        assertSameBackend(scope)
        const suffix = offset ? `?offset=${offset}` : ''
        const page = await backendRequest<{ items: CatalogSourceResponse[]; total: number }>(`/v1/catalog/sources${suffix}`)
        if (!Array.isArray(page?.items)) throw new Error('The backend returned an invalid source list.')
        sources.push(...page.items)
        offset += page.items.length
        if (!page.items.length || offset >= page.total) break
      }
      if (version !== loadVersion || scope !== getBackendScope()) return
      inventory.syncSources(sources.map((source) => {
        const normalized = normalizeSource(source, scope)
        const cached = inventory.getSource(source.id)
        if (cached?.backend_url === scope) normalized.health = cached.health
        return normalized
      }), scope)
    } finally {
      if (version === loadVersion) loading.value = false
    }
  }

  async function createSource(input: CatalogSourceInput): Promise<GitSource> {
    const scope = getBackendScope()
    const source = await backendRequest<CatalogSourceResponse>('/v1/catalog/sources', {
      method: 'POST', body: JSON.stringify(input),
    })
    return remember(source, scope)
  }

  async function connectDefault(): Promise<GitSource> {
    const scope = getBackendScope()
    const source = await backendRequest<CatalogSourceResponse>('/v1/catalog/sources/default', { method: 'POST' })
    return remember(source, scope)
  }

  async function refreshSource(id: string): Promise<RefreshResult> {
    const scope = getBackendScope()
    if (inventory.getSource(id)?.backend_url !== scope) throw new Error('Reload sources before refreshing this repository.')
    inventory.updateSourceHealth(id, { status: 'unknown' })
    try {
      const result = await backendRequest<RefreshResult>(`/v1/catalog/sources/${encodeURIComponent(id)}/refresh`, { method: 'POST' })
      assertSameBackend(scope)
      const source = inventory.getSource(id)
      if (source) source.repos.forEach((repo) => { repo.last_refreshed_at = result.finished_at })
      inventory.updateSourceHealth(id, {
        status: result.repos_seen > 0 && result.entries_indexed > 0 ? 'ok' : 'degraded',
        checked_at: result.finished_at,
        repos_seen: result.repos_seen,
        entries_indexed: result.entries_indexed,
      })
      return result
    } catch (error) {
      if (scope === getBackendScope()) {
        inventory.updateSourceHealth(id, {
          status: 'down', checked_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  async function deleteSource(id: string): Promise<void> {
    const scope = getBackendScope()
    await backendRequest<void>(`/v1/catalog/sources/${encodeURIComponent(id)}`, { method: 'DELETE' })
    assertSameBackend(scope)
    inventory.removeSource(id)
  }

  async function rotateToken(id: string, token: string): Promise<void> {
    const scope = getBackendScope()
    const source = await backendRequest<CatalogSourceResponse>(`/v1/catalog/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ auth_kind: token ? 'pat' : 'none', token_ref: token || null }),
    })
    remember(source, scope)
  }

  return { loading, loadSources, createSource, connectDefault, refreshSource, deleteSource, rotateToken }
}

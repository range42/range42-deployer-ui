import { ref } from 'vue'
import { clearCatalogCache } from '@/composables/useCatalog'
import { useBackendApiStore } from '@/stores/backendApiStore'
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

function sourceContext() {
  const backend = useBackendApiStore()
  const scope = getBackendScope(), token = backend.token, hostId = backend.activeHost?.id
  const isCurrent = () => getBackendScope() === scope && backend.token === token && backend.activeHost?.id === hostId
  return { scope, isCurrent, assertCurrent() {
    if (!isCurrent()) throw new Error('The selected backend or credential changed. Reload sources before continuing.')
  } }
}

type SourceContext = ReturnType<typeof sourceContext>

async function mutateSource<T>(context: SourceContext, path: string, init: RequestInit): Promise<T> {
  context.assertCurrent()
  await clearCatalogCache()
  context.assertCurrent()
  try {
    const result = await backendRequest<T>(path, init)
    context.assertCurrent()
    return result
  } finally {
    await clearCatalogCache()
    context.assertCurrent()
  }
}

/** Backend-owned catalog registrations. Tokens are sent once and never cached. */
export function useCatalogSources() {
  const inventory = useInventoryStore()
  const loading = ref(false)
  let loadVersion = 0

  function remember(source: CatalogSourceResponse, context: SourceContext): GitSource {
    context.assertCurrent()
    const { scope } = context
    const normalized = normalizeSource(source, scope)
    const current = inventory.sources.filter((item) => item.backend_url === scope && item.id !== source.id)
    inventory.syncSources([...current, normalized], scope)
    return normalized
  }

  async function loadSources(): Promise<void> {
    const context = sourceContext(), { scope } = context
    const version = ++loadVersion
    loading.value = true
    try {
      const sources: CatalogSourceResponse[] = []
      let offset = 0
      while (true) {
        context.assertCurrent()
        if (version !== loadVersion) return
        const suffix = offset ? `?offset=${offset}` : ''
        const page = await backendRequest<{ items: CatalogSourceResponse[]; total: number }>(`/v1/catalog/sources${suffix}`)
        context.assertCurrent()
        if (version !== loadVersion) return
        if (!Array.isArray(page?.items)) throw new Error('The backend returned an invalid source list.')
        sources.push(...page.items)
        offset += page.items.length
        if (!page.items.length || offset >= page.total) break
      }
      context.assertCurrent()
      if (version !== loadVersion) return
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
    const context = sourceContext()
    const source = await mutateSource<CatalogSourceResponse>(context, '/v1/catalog/sources', {
      method: 'POST', body: JSON.stringify(input),
    })
    return remember(source, context)
  }

  async function connectDefault(kind: 'catalog' | 'bundles' = 'catalog'): Promise<GitSource> {
    const context = sourceContext()
    const source = await mutateSource<CatalogSourceResponse>(context, `/v1/catalog/sources/default${kind === 'bundles' ? '?kind=bundles' : ''}`, { method: 'POST' })
    return remember(source, context)
  }

  async function refreshSource(id: string): Promise<RefreshResult> {
    const context = sourceContext(), { scope } = context
    if (inventory.getSource(id)?.backend_url !== scope) throw new Error('Reload sources before refreshing this repository.')
    inventory.updateSourceHealth(id, { status: 'unknown' })
    try {
      const result = await mutateSource<RefreshResult>(context, `/v1/catalog/sources/${encodeURIComponent(id)}/refresh`, { method: 'POST' })
      context.assertCurrent()
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
      if (context.isCurrent()) {
        inventory.updateSourceHealth(id, {
          status: 'down', checked_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  async function deleteSource(id: string): Promise<void> {
    const context = sourceContext()
    await mutateSource<void>(context, `/v1/catalog/sources/${encodeURIComponent(id)}`, { method: 'DELETE' })
    context.assertCurrent()
    inventory.removeSource(id)
  }

  async function rotateToken(id: string, token: string): Promise<void> {
    const context = sourceContext()
    const source = await mutateSource<CatalogSourceResponse>(context, `/v1/catalog/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ auth_kind: token ? 'pat' : 'none', token_ref: token || null }),
    })
    remember(source, context)
  }

  return { loading, loadSources, createSource, connectDefault, refreshSource, deleteSource, rotateToken }
}

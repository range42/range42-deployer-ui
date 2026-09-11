import { expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogSources } from '@/composables/useCatalogSources'
import { useInventoryStore } from '@/stores/inventoryStore'

it('connects the default SDN bundle source separately from the default catalog', async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'bundles', provider: 'github', base_url: 'https://github.com', auth_kind: 'none', repos: [{ owner: 'range42', repo: 'range42-playbooks', branch: 'feat-sdn-implementation' }] })))
  try {
    await useCatalogSources().connectDefault('bundles')
    expect(fetch.mock.calls[0][0]).toBe('/v1/catalog/sources/default?kind=bundles')
    expect(useInventoryStore().getSource('bundles').repos[0].branch).toBe('feat-sdn-implementation')
  } finally { fetch.mockRestore() }
})

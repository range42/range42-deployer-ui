import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Spy on the v1 provider factory and the adapter factory so we can assert how
// useProjectRepo wires auth, without performing real git IO. vi.mock is hoisted,
// so the spies are created via vi.hoisted to stay accessible from the factories.
const { getProvider, fakeAdapter } = vi.hoisted(() => ({
  getProvider: vi.fn(() => ({ id: 'github' })),
  fakeAdapter: {
    load: vi.fn(async () => ({ overlay: '', canvas_layout: '', meta: {} })),
    autosave: vi.fn(async () => {}),
    save: vi.fn(async () => ({})),
    onOrphanedDraft: vi.fn(),
    checkLockOwnership: vi.fn(async () => 'owner'),
  },
}))
vi.mock('@/services/git', () => ({ getProvider }))
vi.mock('@/services/projectRepo', () => ({
  createProjectRepoAdapter: vi.fn(() => fakeAdapter),
}))

import { useProjectRepo } from '@/composables/useProjectRepo'
import { useInventoryStore } from '@/stores/inventoryStore'

function mountWith(opts) {
  const Harness = defineComponent({
    setup() {
      useProjectRepo(opts)
      return () => h('div')
    },
  })
  return mount(Harness)
}

describe('useProjectRepo — PAT wiring (C2.1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    getProvider.mockClear()
  })

  it('passes the stored PAT for the source into getProvider, keyed by source id', async () => {
    const inv = useInventoryStore()
    inv.setToken('src-gh', 'pat-xyz')

    mountWith({
      projectId: 'p1',
      source: { id: 'src-gh', provider: 'github', base_url: 'https://github.com' },
      projectPath: 'projects/demo',
    })
    await flushPromises()

    expect(getProvider).toHaveBeenCalledTimes(1)
    const [kind, providerOpts] = getProvider.mock.calls[0]
    expect(kind).toBe('github') // no longer remapped to gitea
    expect(providerOpts.token).toBe('pat-xyz')
    expect(providerOpts.baseUrl).toBe('https://github.com')
  })

  it('passes a null token when the source has no stored PAT', async () => {
    mountWith({
      projectId: 'p2',
      source: { id: 'src-none', provider: 'gitea', base_url: 'https://gitea.example' },
      projectPath: '',
    })
    await flushPromises()

    const [kind, providerOpts] = getProvider.mock.calls[0]
    expect(kind).toBe('gitea')
    expect(providerOpts.token).toBeNull()
  })
})

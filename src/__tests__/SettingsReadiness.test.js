import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Settings from '@/views/Settings.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

let wrapper
let backend

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  backend = useBackendApiStore()
  backend.addHost({ url: 'https://backend.test', nodeName: 'pve01' })
})
afterEach(() => wrapper?.unmount())

async function show(checks, ready = true) {
  backend.updateHost(backend.activeHost.id, {
    health: { status: ready ? 'ok' : 'degraded', ready, checks, ts: new Date().toISOString() },
  })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: Settings }] })
  await router.push('/')
  wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper.get('[data-testid="settings-backend-api"]')
}

describe('backend readiness details', () => {
  it.each([
    { ok: null, required: false, connectivity: 'not_checked', sources_registered: 2 },
    { ok: true, sources_registered: 2 },
  ])('does not present registered repositories as tested connectivity', async git => {
    const panel = await show({ sqlite_wal: { ok: true }, git })
    const check = panel.get('[data-testid="readiness-git"]')
    expect(check.text()).toContain('Git repositories')
    expect(check.text()).toContain('Not checked')
    expect(check.text()).toContain('2 sources registered')
    expect(check.find('.badge-success').exists()).toBe(false)
    expect(panel.get('[data-testid="readiness-sqlite_wal"]').text()).toContain('Passed')
  })

  it('explains the failed dependency without rendering private backend error strings', async () => {
    const panel = await show({
      proxmox: { ok: false, hosts: [{ id: 'host', ok: false, err: 'private-diagnostic-sentinel' }] },
      workspace_writable: { ok: true },
    }, false)
    const check = panel.get('[data-testid="readiness-proxmox"]')
    expect(check.text()).toContain('Proxmox access')
    expect(check.text()).toContain('Failed')
    expect(check.text()).toContain('credentials')
    expect(panel.text()).not.toContain('private-diagnostic-sentinel')
  })
})

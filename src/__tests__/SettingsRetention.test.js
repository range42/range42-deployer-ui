import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Settings from '@/views/Settings.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useToast } from '@/composables/useToast'

let wrapper
let fetchMock

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useBackendApiStore().addHost({ url: 'https://backend.test', token: 'operator-token', nodeName: 'pve01' })
  fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  wrapper?.unmount()
  const { toasts, removeToast } = useToast()
  for (const toast of [...toasts.value]) removeToast(toast.id)
  vi.unstubAllGlobals()
})

async function show() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Settings }] })
  await router.push('/')
  wrapper = mount(Settings, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper.get('[data-testid="settings-snapshot-retention"]')
}

async function save(panel) {
  await panel.get('button').trigger('click')
  await flushPromises()
}

describe('stored snapshot retention preferences', () => {
  it('retains saved values but explains that automatic cleanup is not enabled', async () => {
    localStorage.setItem('range42_snapshot_retention', JSON.stringify({ keep_count: 12, keep_days: 30 }))
    const panel = await show()
    expect(panel.get('[data-testid="retention-keep-count"]').element.value).toBe('12')
    expect(panel.get('[data-testid="retention-keep-days"]').element.value).toBe('30')
    expect(panel.get('[data-testid="retention-inactive"]').text()).toContain('Not enforced')
    expect(panel.text()).toContain('does not automatically expire or delete snapshots')
    expect(panel.text()).not.toContain('Per-deployment overrides')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('distinguishes successful storage from enabling cleanup', async () => {
    const panel = await show()
    await panel.get('[data-testid="retention-keep-count"]').setValue('8')
    await save(panel)
    expect(fetchMock).toHaveBeenCalledWith('https://backend.test/v1/admin/retention', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ keep_count: 8, keep_days: 7 }),
    }))
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer operator-token')
    expect(JSON.parse(localStorage.getItem('range42_snapshot_retention'))).toEqual({ keep_count: 8, keep_days: 7 })
    expect(panel.get('[role="status"]').text()).toContain('Stored on backend; automatic cleanup is not enabled')
    expect(panel.get('[data-testid="retention-inactive"]').text()).toContain('Not enforced')
    expect(useToast().toasts.value.at(-1).message).toContain('automatic cleanup is not enabled')
  })

  it('reports an HTTP refusal without claiming the backend was unreachable', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))
    const panel = await show()
    await save(panel)
    expect(panel.get('[role="status"]').text()).toContain('Stored locally only; backend refused (HTTP 403)')
    expect(panel.get('[role="status"]').text()).not.toContain('unreachable')
    expect(panel.get('[data-testid="retention-inactive"]').text()).toContain('Not enforced')
  })

  it('keeps preferences local and explains an unavailable backend', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const panel = await show()
    await save(panel)
    expect(panel.get('[role="status"]').text()).toContain('Stored locally only; backend unreachable')
    expect(JSON.parse(localStorage.getItem('range42_snapshot_retention'))).toEqual({ keep_count: 5, keep_days: 7 })
    expect(panel.get('[data-testid="retention-inactive"]').text()).toContain('Not enforced')
  })
})

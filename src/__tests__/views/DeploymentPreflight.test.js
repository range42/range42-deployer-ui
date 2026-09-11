import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import DeploymentPreflight from '@/views/DeploymentPreflight.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import deploymentEn from '@/locales/en/deployment.json'
import commonEn from '@/locales/en/common.json'

enableAutoUnmount(afterEach)

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { deployment: deploymentEn, common: commonEn } },
  })
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployments', name: 'deployments', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
      {
        path: '/deployments/:id/preflight',
        name: 'deployment-preflight',
        component: { template: '<div/>' },
      },
    ],
  })
}

async function settle(wrapper, selector = '[data-testid="preflight-title"]') {
  for (let i = 0; i < 50; i++) {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 0))
    await wrapper?.vm?.$nextTick?.()
    if (wrapper?.find(selector).exists()) return
  }
}

function makeRecord(overrides = {}) {
  return {
    checks: [
      { check: 'vmid_free', result: 'pass', detail: 'range 2100-2999 clear' },
      { check: 'ip_conflict', result: 'warn', detail: 'overlap on 10.0.0.0/24' },
    ],
    ok: false,
    blocking: false,
    generated_at: '2026-04-14T10:00:00Z',
    attempt_id: 'att-7',
    ...overrides,
  }
}

function makeMeta(overrides = {}) {
  return {
    id: 'd-1',
    codename: 'alpha-lab',
    scenario_label: 'Forensics Lab',
    team_count: 2,
    state: 'deployed',
    ...overrides,
  }
}

function routedFetch({ meta, preflight, preflightStatus = 200, metaStatus = 200 }) {
  return vi.fn(async (url) => {
    if (url.endsWith('/preflight')) {
      return {
        ok: preflightStatus < 400,
        status: preflightStatus,
        json: async () => preflight,
      }
    }
    return {
      ok: metaStatus < 400,
      status: metaStatus,
      json: async () => meta,
    }
  })
}

describe('<DeploymentPreflight>', () => {
  let originalFetch
  let originalLocation
  let originalClipboard
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    originalFetch = globalThis.fetch
    originalLocation = window.location
    originalClipboard = navigator.clipboard
    // Stable shareable URL for assertions
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: 'https://range42.example/deployments/d-1/preflight',
      },
    })
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      })
    }
  })

  it('uses the selected backend token and reloads on backend change', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old.test', token: 'old-token' })
    const next = backend.addHost({ url: 'https://new.test', token: 'new-token' })
    globalThis.fetch = routedFetch({ meta: makeMeta(), preflight: makeRecord() })
    const router = makeRouter()
    await router.push('/deployments/d-1/preflight')
    const wrapper = mount(DeploymentPreflight, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://old.test/v1/deployments/d-1')
    backend.setActiveHost(next)
    await flushPromises()
    const calls = globalThis.fetch.mock.calls.slice(-2)
    for (const [url, options] of calls) {
      expect(url).toMatch(/^https:\/\/new.test\/v1\//)
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer new-token')
    }
  })

  it('fetches preflight record and renders the <PreflightReport>', async () => {
    globalThis.fetch = routedFetch({ meta: makeMeta(), preflight: makeRecord() })
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper, '[data-testid="preflight-report"]')
    // Both fetches fired
    const calls = globalThis.fetch.mock.calls.map(c => c[0])
    expect(calls.some(u => u === '/v1/deployments/d-1')).toBe(true)
    expect(calls.some(u => u === '/v1/deployments/d-1/preflight')).toBe(true)
    // The <PreflightReport> primitive is rendered (its root <section> carries this testid).
    expect(wrapper.find('[data-testid="preflight-report"]').exists()).toBe(true)
  })

  it('page title includes codename + scenario_label', async () => {
    globalThis.fetch = routedFetch({ meta: makeMeta(), preflight: makeRecord() })
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const title = wrapper.find('[data-testid="preflight-title"]').text()
    expect(title).toContain('alpha-lab')
    expect(title).toContain('Forensics Lab')
  })

  it('falls back to deployment id in the title when meta is unavailable', async () => {
    globalThis.fetch = routedFetch({
      meta: null,
      metaStatus: 500,
      preflight: makeRecord(),
    })
    const router = makeRouter()
    router.push('/deployments/d-missing/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    expect(wrapper.find('[data-testid="preflight-title"]').text()).toContain('d-missing')
  })

  it('renders a not-found alert on preflight 404', async () => {
    globalThis.fetch = routedFetch({
      meta: makeMeta(),
      preflight: null,
      preflightStatus: 404,
    })
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper, '[data-testid="preflight-not-found"]')
    expect(wrapper.find('[data-testid="preflight-not-found"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="preflight-report"]').exists()).toBe(false)
  })

  it('renders a generic error alert on preflight 500', async () => {
    globalThis.fetch = routedFetch({
      meta: makeMeta(),
      preflight: null,
      preflightStatus: 500,
    })
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper, '[data-testid="preflight-error"]')
    expect(wrapper.find('[data-testid="preflight-error"]').exists()).toBe(true)
  })

  it('back-link points to the parent /deployments/:id', async () => {
    globalThis.fetch = routedFetch({ meta: makeMeta(), preflight: makeRecord() })
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const link = wrapper.find('[data-testid="back-to-deployment"]')
    expect(link.attributes('href')).toBe('/deployments/d-1')
  })

  it('copy-URL button writes the current URL to the clipboard', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    globalThis.fetch = routedFetch({ meta: makeMeta(), preflight: makeRecord() })
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    await wrapper.find('[data-testid="copy-url-btn"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('https://range42.example/deployments/d-1/preflight')
    // Button label should switch to "Link copied"
    expect(wrapper.find('[data-testid="copy-url-btn"]').text()).toBe('Link copied')
  })

  it('reloads when route param id changes', async () => {
    const fetchSpy = routedFetch({ meta: makeMeta(), preflight: makeRecord() })
    globalThis.fetch = fetchSpy
    const router = makeRouter()
    router.push('/deployments/d-1/preflight')
    await router.isReady()
    const wrapper = mount(DeploymentPreflight, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const initialCount = fetchSpy.mock.calls.length
    await router.push('/deployments/d-2/preflight')
    await flushPromises()
    await flushPromises()
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCount)
    // New calls target the new id
    const lastCalls = fetchSpy.mock.calls.slice(initialCount).map(c => c[0])
    expect(lastCalls.some(u => u.includes('/v1/deployments/d-2'))).toBe(true)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import DeploymentDetail from '@/views/DeploymentDetail.vue'
import deploymentEn from '@/locales/en/deployment.json'
import { useDeploymentStore, applySseEvent } from '@/stores/deploymentStore.ts'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { deployment: deploymentEn } },
  })
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployments', name: 'deployments', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
      { path: '/deployments/:id/preflight', name: 'deployment-preflight', component: { template: '<div/>' } },
    ],
  })
}

async function settle(wrapper) {
  for (let i = 0; i < 20; i++) {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 0))
    if (wrapper?.find('[data-testid="detail-state"]').exists()) return
  }
}

function fetchMock(body, status = 200) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))
}

describe('<DeploymentDetail>', () => {
  let originalFetch
  beforeEach(() => {
    setActivePinia(createPinia())
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('defaults to Overview when team_count <= 1', async () => {
    globalThis.fetch = fetchMock({ id: 'd-1', codename: 'alpha', team_count: 1, state: 'deploying' })
    const router = makeRouter()
    router.push('/deployments/d-1')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    expect(wrapper.find('[data-testid="tab-overview"]').classes()).toContain('tab-active')
    expect(wrapper.find('[data-testid="panel-overview"]').attributes('role')).toBe('tabpanel')
  })

  it('defaults to Teams when team_count > 1 AND state is deploying/deployed/partial', async () => {
    globalThis.fetch = fetchMock({ id: 'd-2', codename: 'bravo', team_count: 4, state: 'deploying' })
    const router = makeRouter()
    router.push('/deployments/d-2')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    expect(wrapper.find('[data-testid="tab-teams"]').classes()).toContain('tab-active')
  })

  it('defaults to Overview when team_count > 1 but state terminal non-deployed', async () => {
    globalThis.fetch = fetchMock({ id: 'd-3', codename: 'charlie', team_count: 4, state: 'failed' })
    const router = makeRouter()
    router.push('/deployments/d-3')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    expect(wrapper.find('[data-testid="tab-overview"]').classes()).toContain('tab-active')
  })

  it('honours ?tab= query param over defaults', async () => {
    globalThis.fetch = fetchMock({ id: 'd-4', codename: 'delta', team_count: 4, state: 'deploying' })
    const router = makeRouter()
    router.push('/deployments/d-4?tab=logs')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    expect(wrapper.find('[data-testid="tab-logs"]').classes()).toContain('tab-active')
  })

  it('clicking a tab updates ?tab=', async () => {
    globalThis.fetch = fetchMock({ id: 'd-5', team_count: 1, state: 'deploying' })
    const router = makeRouter()
    router.push('/deployments/d-5')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    await wrapper.find('[data-testid="tab-logs"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('logs')
  })

  it('subscribes to SSE on mount and renders team cards from live store', async () => {
    globalThis.fetch = fetchMock({ id: 'd-6', team_count: 2, state: 'deploying' })
    const router = makeRouter()
    router.push('/deployments/d-6')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const store = useDeploymentStore()
    // Feed a task_start event to create a team slice reactively.
    applySseEvent(store.getOrCreateRecord('d-6'), {
      event_type: 'task_start', event_seq: 1,
      payload: { task_name: 't', team_id: 'team-1' },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="teams-grid"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('team-1')
  })

  it('cancel button POSTs to /cancel endpoint', async () => {
    const fetchSpy = vi.fn(async (url) => {
      if (url.endsWith('/cancel')) return { ok: true, status: 200, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ id: 'd-7', team_count: 1, state: 'deploying' }) }
    })
    globalThis.fetch = fetchSpy
    const router = makeRouter()
    router.push('/deployments/d-7')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const cancelBtn = wrapper.findAll('button').find(b => b.text() === 'Cancel deployment')
    await cancelBtn.trigger('click')
    await flushPromises()
    const cancelCall = fetchSpy.mock.calls.find(c => c[0].endsWith('/cancel'))
    expect(cancelCall).toBeTruthy()
    expect(cancelCall[1]?.method).toBe('POST')
  })
})

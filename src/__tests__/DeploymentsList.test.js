import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import DeploymentsList from '@/views/DeploymentsList.vue'
import deploymentEn from '@/locales/en/deployment.json'

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
    ],
  })
}

function fetchMock(deployments) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ deployments }),
  }))
}

async function settle(wrapper) {
  // Let onMounted chain (ensureNamespaces → fetch → state update) fully settle.
  // In jsdom the async import chain can span several macrotasks. Keep pumping
  // until either the list renders or we give up.
  for (let i = 0; i < 20; i++) {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!wrapper) continue
    if (wrapper.find('[data-testid="deployments-root"]').exists()) return
    if (wrapper.text().includes('No deployments yet')) return
    if (wrapper.find('.alert-warning').exists()) return
  }
}

const SAMPLE = [
  { id: 'd-1', codename: 'alpha', scenario_label: 'demo_lab', state: 'deploying', started_at: '2026-04-14T10:00Z', attempts_count: 1, project_id: 'p1', project_name: 'Project One' },
  { id: 'd-2', codename: 'bravo', scenario_label: 'forensics_lab', state: 'deployed', started_at: '2026-04-13T10:00Z', attempts_count: 2, project_id: 'p1', project_name: 'Project One' },
  { id: 'd-3', codename: 'charlie', scenario_label: 'misp_lab', state: 'failed', started_at: '2026-04-12T10:00Z', attempts_count: 3, project_id: 'p2', project_name: 'Project Two' },
  { id: 'd-4', codename: 'delta', scenario_label: 'kunai_lab', state: 'torn_down', started_at: '2026-04-11T10:00Z', attempts_count: 1, project_id: null, project_name: null },
]

describe('<DeploymentsList>', () => {
  let originalFetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('splits active from past and groups past by project', async () => {
    globalThis.fetch = fetchMock(SAMPLE)
    const router = makeRouter()
    router.push('/deployments')
    await router.isReady()
    const wrapper = mount(DeploymentsList, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)

    // Active section has the 'deploying' one.
    const active = wrapper.find('[data-testid="deployments-active"]')
    expect(active.exists()).toBe(true)
    expect(active.text()).toContain('alpha')
    expect(active.text()).not.toContain('bravo')

    // Past section groups by project.
    const past = wrapper.find('[data-testid="deployments-past"]')
    const groups = past.findAll('[data-testid="past-group"]')
    expect(groups.length).toBe(3) // Project One, Project Two, (no project)
    expect(groups[0].text()).toContain('Project One')
    expect(groups[0].text()).toContain('bravo')
  })

  it('failed-only filter keeps only failed deployments', async () => {
    globalThis.fetch = fetchMock(SAMPLE)
    const router = makeRouter()
    router.push('/deployments')
    await router.isReady()
    const wrapper = mount(DeploymentsList, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const failedBtn = wrapper.findAll('button').find(b => b.text() === 'Failed only')
    await failedBtn.trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="deployment-row"]')
    expect(rows.length).toBe(1)
    expect(rows[0].text()).toContain('charlie')
  })

  it('in-progress-only filter hides terminal states', async () => {
    globalThis.fetch = fetchMock(SAMPLE)
    const router = makeRouter()
    router.push('/deployments')
    await router.isReady()
    const wrapper = mount(DeploymentsList, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    const inProgBtn = wrapper.findAll('button').find(b => b.text() === 'In-progress only')
    await inProgBtn.trigger('click')
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="deployment-row"]')
    expect(rows.length).toBe(1)
    expect(rows[0].text()).toContain('alpha')
  })

  it('shows empty state when backend returns zero deployments', async () => {
    globalThis.fetch = fetchMock([])
    const router = makeRouter()
    router.push('/deployments')
    await router.isReady()
    const wrapper = mount(DeploymentsList, {
      global: { plugins: [router, makeI18n()] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No deployments yet')
  })

  it('shows load-error alert when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const router = makeRouter()
    router.push('/deployments')
    await router.isReady()
    const wrapper = mount(DeploymentsList, {
      global: { plugins: [router, makeI18n()] },
    })
    await flushPromises()
    expect(wrapper.html()).toContain('ECONNREFUSED')
  })
})

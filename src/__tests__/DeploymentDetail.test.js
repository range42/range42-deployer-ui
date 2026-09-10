import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import DeploymentDetail from '@/views/DeploymentDetail.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import RuntimeControls from '@/components/deployment/RuntimeControls.vue'
import RuntimeGitRecords from '@/components/deployment/RuntimeGitRecords.vue'
import runtimeEn from '@/locales/en/runtime.json'
import deploymentEn from '@/locales/en/deployment.json'
import { useDeploymentStore, applySseEvent } from '@/stores/deploymentStore.ts'

vi.mock('@/components/deployment/RuntimeControls.vue', () => ({ default: {
  props: ['deploymentId', 'disabled'], emits: ['started'], template: '<section data-testid="runtime-stub" />',
} }))

enableAutoUnmount(afterEach)

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { deployment: deploymentEn, runtime: runtimeEn } },
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
    localStorage.clear()
    setActivePinia(createPinia())
    setActivePinia(createPinia())
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('offers a quiet log view and a protected finite download', async () => {
    globalThis.fetch = fetchMock({ id: 'd-logs', codename: 'LOGS', state: 'succeeded' })
    const router = makeRouter()
    await router.push('/deployments/d-logs?tab=logs')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    const live = useDeploymentStore().deployments['d-logs']
    applySseEvent(live, { event_type: 'log_line', event_seq: 1, payload: { text: 'included noisy tasks', ansible_event: 'playbook_on_include' } })
    applySseEvent(live, { event_type: 'log_line', event_seq: 2, payload: { text: 'useful output', ansible_event: 'verbose' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="logs-list"]').text()).toContain('useful output')
    expect(wrapper.get('[data-testid="logs-list"]').text()).not.toContain('included noisy tasks')
    await wrapper.get('[data-testid="logs-show-routine"]').setValue(true)
    expect(wrapper.get('[data-testid="logs-list"]').text()).toContain('included noisy tasks')
    expect(wrapper.get('[data-testid="logs-download"]').element.tagName).toBe('BUTTON')
  })

  it('routes metadata and cancel to the selected authenticated backend', async () => {
    useBackendApiStore().addHost({ url: 'https://backend.test', token: 'gateway' })
    globalThis.fetch = fetchMock({ id: 'd-1', codename: 'ALPHA', state: 'deploying' })
    const router = makeRouter()
    await router.push('/deployments/d-1')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    await wrapper.findAll('button').find(b => b.text() === 'Cancel deployment').trigger('click')
    await flushPromises()
    const calls = globalThis.fetch.mock.calls.filter(([url]) => !url.includes('/events'))
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const [url, options] of calls) {
      expect(url).toMatch(/^https:\/\/backend.test\/v1\//)
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer gateway')
    }
  })

  it.each(['pass', 'block', 'warn'])('requires deployment preflight before start: %s', async result => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('/preflight')) return { ok: true, status: 200, json: async () => ({
        result, checks: [{ check: 'sdn', result, detail: 'Network readiness' }],
      }) }
      if (url.endsWith('/attempts')) return { ok: true, status: 201, json: async () => ({ id: 'attempt-1', state: 'deploying' }) }
      return { ok: true, status: 200, json: async () => ({ id: 'd-1', codename: 'ALPHA', state: 'pending' }) }
    })
    const router = makeRouter()
    await router.push('/deployments/d-1')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    const start = wrapper.find('[data-testid="deployment-start"]')
    expect(start.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="deployment-run-preflight"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Network readiness')
    if (result === 'block') {
      expect(start.attributes('disabled')).toBeDefined()
    } else {
      if (result === 'warn') {
        expect(start.attributes('disabled')).toBeDefined()
        await wrapper.find('[data-testid="deployment-warnings-ack"]').setValue(true)
      }
      await start.trigger('click')
      await flushPromises()
      const attempt = globalThis.fetch.mock.calls.find(([url, options]) => url.endsWith('/attempts') && options?.method === 'POST')
      expect(attempt[1].method).toBe('POST')
      expect(JSON.parse(attempt[1].body)).toEqual({ scope: 'full' })
    }
  })

  it('clears stale metadata and live records after backend switching', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old.test' })
    const next = backend.addHost({ url: 'https://new.test' })
    let oldResponse
    globalThis.fetch = vi.fn(url => url.startsWith('https://old.test')
      ? new Promise(resolve => { oldResponse = resolve })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ codename: 'NEW', state: 'failed' }) }))
    const router = makeRouter()
    await router.push('/deployments/d-1')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    backend.setActiveHost(next)
    await flushPromises()
    oldResponse({ ok: true, status: 200, json: async () => ({ codename: 'OLD', state: 'deploying' }) })
    await flushPromises()
    expect(wrapper.text()).toContain('NEW')
    expect(wrapper.text()).not.toContain('OLD')
  })

  it('shows a successful concrete deployment at 100% with actual attempt history and no unsupported actions', async () => {
    globalThis.fetch = vi.fn(async url => ({ ok: true, status: 200, json: async () =>
      url.endsWith('/attempts')
        ? { items: [{ id: 'real-attempt', state: 'succeeded' }], total: 1 }
        : { id: 'd-success', state: 'succeeded', project_sha: 'a'.repeat(40), scenario_label: 'script_lab' },
    }))
    const router = makeRouter()
    await router.push('/deployments/d-success')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    expect(wrapper.find('progress').attributes('value')).toBe('100')
    expect(wrapper.text()).toContain('real-attempt')
    expect(wrapper.text()).not.toContain('No attempts recorded yet')
    expect(wrapper.findAll('button').some(button => button.text() === 'Cancel deployment')).toBe(false)
    expect(wrapper.find('[data-testid="detail-teardown-open"]').exists()).toBe(false)
  })

  it('shows partial runtime results and missing guests in attempt history', async () => {
    globalThis.fetch = vi.fn(async url => ({ ok: true, status: 200, json: async () =>
      url.endsWith('/attempts') ? { items: [{ id: 'runtime-partial', scope: 'runtime', state: 'partial',
        operation: { request: { kind: 'scenario_firewall', enabled: true } },
        operation_result: { desired_reached: false, partial: true, missing_vmids: [3192], mismatched_vmids: [3193] },
      }] } : { id: 'd-result', state: 'partial', project_sha: 'a'.repeat(40), scenario_label: 'demo' },
    }))
    const router = makeRouter()
    await router.push('/deployments/d-result')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    const result = wrapper.get('[data-testid="runtime-result"]')
    expect(result.text()).toContain('Requested state was not fully confirmed')
    expect(result.text()).toContain('Missing guests: 3192')
    expect(result.text()).toContain('Guests with a different state: 3193')
  })

  it('refreshes history and blocks further changes when a runtime operation starts', async () => {
    let running = false
    globalThis.fetch = vi.fn(async url => ({ ok: true, status: 200, json: async () =>
      url.endsWith('/attempts') ? { items: running ? [{ id: 'runtime-1', scope: 'runtime', state: 'deploying' }] : [] }
        : { id: 'd-runtime', state: running ? 'running_attempt' : 'succeeded', project_sha: 'a'.repeat(40), scenario_label: 'demo' },
    }))
    const router = makeRouter()
    await router.push('/deployments/d-runtime')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    const controls = wrapper.getComponent(RuntimeControls)
    expect(controls.props('deploymentId')).toBe('d-runtime')
    expect(controls.props('disabled')).toBe(false)
    useDeploymentStore().deployments['d-runtime'].state = 'succeeded'
    running = true
    controls.vm.$emit('started', { id: 'runtime-1', scope: 'runtime', state: 'deploying' })
    await flushPromises()
    expect(wrapper.getComponent(RuntimeGitRecords).props('newAttempt').id).toBe('runtime-1')
    expect(wrapper.text()).toContain('runtime-1')
    expect(wrapper.getComponent(RuntimeControls).props('disabled')).toBe(true)
  })

  it('preflights and runs a chosen configure revision, invalidating the check after a revision edit', async () => {
    const base = 'a'.repeat(40)
    const latest = 'b'.repeat(40)
    globalThis.fetch = vi.fn(async (url, options = {}) => ({ ok: true, status: 200, json: async () => {
      if (url.endsWith('/preflight')) return { result: 'pass', checks: [{ check: 'ownership', result: 'pass', detail: 'Owned VMs' }] }
      if (url.endsWith('/attempts')) return options.method === 'POST' ? { id: 'configure-attempt', state: 'deploying' } : { items: [], total: 0 }
      return { id: 'd-1', project_id: 'registered', codename: 'DEMO', state: 'succeeded', project_sha: base, scenario_label: 'demo' }
    } }))
    const router = makeRouter()
    await router.push('/deployments/d-1')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    const revision = wrapper.get('[data-testid="configure-project-sha"]')
    const start = wrapper.get('[data-testid="maintenance-start"]')
    expect(start.attributes('disabled')).toBeDefined()
    await revision.setValue(latest)
    await wrapper.get('[data-testid="maintenance-preflight"]').trigger('click')
    await flushPromises()
    let preflightCall = globalThis.fetch.mock.calls.filter(([url]) => url.endsWith('/preflight')).at(-1)
    expect(JSON.parse(preflightCall[1].body)).toEqual({ scope: 'configure', project_sha: latest })
    expect(start.attributes('disabled')).toBeUndefined()
    await revision.setValue('c'.repeat(40))
    expect(start.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="maintenance-preflight"]').trigger('click')
    await flushPromises()
    preflightCall = globalThis.fetch.mock.calls.filter(([url]) => url.endsWith('/preflight')).at(-1)
    await start.trigger('click')
    await flushPromises()
    const attemptCall = globalThis.fetch.mock.calls.find(([url, options]) => url.endsWith('/attempts') && options?.method === 'POST')
    expect(attemptCall[1].body).toBe(preflightCall[1].body)
    expect(globalThis.fetch.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('requires scoped preflight and codename confirmation before a concrete teardown attempt', async () => {
    globalThis.fetch = vi.fn(async (url, options = {}) => ({ ok: true, status: 200, json: async () => {
      if (url.endsWith('/preflight')) return { result: 'pass', checks: [] }
      if (url.endsWith('/attempts')) return options.method === 'POST' ? { id: 'teardown-attempt', state: 'deploying' } : { items: [], total: 0 }
      return { id: 'd-1', codename: 'DEMO', state: 'succeeded', project_sha: 'a'.repeat(40), scenario_label: 'demo' }
    } }))
    const router = makeRouter()
    await router.push('/deployments/d-1')
    const wrapper = mount(DeploymentDetail, { global: { plugins: [router, makeI18n()] } })
    await settle(wrapper)
    await wrapper.get('[data-testid="maintenance-scope"]').setValue('teardown')
    await wrapper.get('[data-testid="maintenance-preflight"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="maintenance-start"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="maintenance-confirm"]').setValue('DEMO')
    await wrapper.get('[data-testid="maintenance-start"]').trigger('click')
    await flushPromises()
    const attemptCall = globalThis.fetch.mock.calls.find(([url, options]) => url.endsWith('/attempts') && options?.method === 'POST')
    expect(JSON.parse(attemptCall[1].body)).toEqual({ scope: 'teardown' })
    expect(globalThis.fetch.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('defaults to Overview when team_count <= 1'  , async () => {
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

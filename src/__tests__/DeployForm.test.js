import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { useBackendApiStore } from '@/stores/backendApiStore'
import DeployForm from '@/components/project/DeployForm.vue'
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
      { path: '/', name: 'home', component: { template: '<div/>' } },
      { path: '/deployments/:id', name: 'deployment-detail', component: { template: '<div/>' } },
    ],
  })
}

function baseProps(overrides = {}) {
  return {
    visible: true,
    projectId: 'project-1',
    projectName: 'Test Project',
    catalogSha: 'aabbccdd11223344',
    projectSha: 'eeff0011aabb2233',
    existingCodenames: ['ALREADY-TAKEN'],
    ...overrides,
  }
}

function fetchMockHosts(extra = {}) {
  return vi.fn(async (url, opts) => {
    if (typeof url !== 'string') url = String(url)
    if (url.includes('/v1/proxmox/hosts') && (!opts || opts.method !== 'POST')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          items: [
            { id: 'host-1', name: 'pve01', node_name: 'pve' },
            { id: 'host-2', name: 'pve02', node_name: 'pve' },
          ],
          total: 2, offset: 0, limit: 100,
        }),
      }
    }
    if (url.includes('/validate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, blocking: false, checks: [], generated_at: '2026-04-14T12:00:00Z' }),
      }
    }
    if (url.includes('/v1/deployments') && opts?.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 'dep-new', codename: extra.codename || 'alpha' }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

describe('<DeployForm>', () => {
  let originalFetch
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('renders fields: codename, scenario_label, target_host, team_count, vault pw, SHA-pin', async () => {
    globalThis.fetch = fetchMockHosts()
    const wrapper = mount(DeployForm, {
      props: baseProps(),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="deploy-field-codename"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-field-scenario"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-field-host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-field-team-count"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-field-vault"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-sha-pin"]').exists()).toBe(true)
  })

  it('blocks submission when codename is empty', async () => {
    globalThis.fetch = fetchMockHosts()
    const wrapper = mount(DeployForm, {
      props: baseProps(),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    const deployBtn = wrapper.find('[data-testid="deploy-submit"]')
    expect(deployBtn.attributes('disabled')).toBeDefined()
  })

  it('flags collision against existingCodenames', async () => {
    globalThis.fetch = fetchMockHosts()
    const wrapper = mount(DeployForm, {
      props: baseProps(),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('already-taken')
    await flushPromises()
    expect(wrapper.find('[data-testid="deploy-err-codename"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-err-codename"]').text()).toMatch(/already|taken|used/i)
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
  })

  it('submits POST /v1/deployments and navigates when valid', async () => {
    const fetchSpy = fetchMockHosts({ codename: 'alpha' })
    globalThis.fetch = fetchSpy
    const router = makeRouter()
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(DeployForm, {
      props: baseProps(),
      global: { plugins: [router, makeI18n()] },
    })
    await flushPromises()
    await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('alpha')
    await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
    await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host-1')
    await wrapper.find('[data-testid="deploy-field-team-count"] input').setValue(2)
    await wrapper.get('[data-testid="deploy-vault-override"]').setValue(true)
    await wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').setValue('s3cret')
    await wrapper.find('[data-testid="deploy-sha-ack"] input').setValue(true)
    await flushPromises()
    const btn = wrapper.find('[data-testid="deploy-submit"]')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    await flushPromises()
    const postCall = fetchSpy.mock.calls.find(c => {
      const url = String(c[0])
      return url.endsWith('/v1/deployments') && c[1]?.method === 'POST'
    })
    expect(postCall).toBeTruthy()
    const body = JSON.parse(postCall[1].body)
    expect(body.codename).toBe('ALPHA')
    expect(body.scenario_label).toBe('demo_lab')
    // Field names must match DeploymentCreate exactly — target_host (no _id)
    // was rejected as a missing required field, so no deploy ever succeeded.
    expect(body.target_host_id).toBe('host-1')
    expect(body.target_host).toBeUndefined()
    expect(body.team_count).toBe(2)
    expect(body.catalog_sha).toBe('aabbccdd11223344')
    expect(body.project_sha).toBe('eeff0011aabb2233')
    // The backend takes the vault password under `secrets`, and writes it to
    // <workspace>/secrets/vault_pass.txt for the deploy run.
    expect(body.secrets).toEqual({ vault_password: 's3cret' })
    expect(body.vault_password).toBeUndefined()
    expect(pushSpy).toHaveBeenCalledWith({ name: 'deployment-detail', params: { id: 'dep-new' } })
  })

  it('uses backend credentials by default and omits secrets entirely', async () => {
    const fetchSpy = fetchMockHosts()
    globalThis.fetch = fetchSpy
    const wrapper = mount(DeployForm, { props: baseProps({ gamenet: false }), global: { plugins: [makeRouter(), makeI18n()] } })
    await flushPromises()
    await wrapper.get('[data-testid="deploy-field-codename"] input').setValue('alpha')
    await wrapper.get('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
    await wrapper.get('[data-testid="deploy-field-host"] select').setValue('host-1')
    await wrapper.get('[data-testid="deploy-sha-ack"] input').setValue(true)
    expect(wrapper.get('[data-testid="deploy-submit"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('credentials configured on the backend')
    await wrapper.get('[data-testid="deploy-submit"]').trigger('click')
    await flushPromises()
    const request = fetchSpy.mock.calls.find(([url, options]) => String(url).endsWith('/deployments') && options?.method === 'POST')
    expect(JSON.parse(request[1].body)).not.toHaveProperty('secrets')
  })

  it('requires a nonblank password only for an explicit custom credential override', async () => {
    globalThis.fetch = fetchMockHosts()
    const { wrapper } = await validForm()
    await wrapper.get('[data-testid="deploy-vault-override"]').setValue(true)
    await wrapper.get('[data-testid="deploy-field-vault"] input[type="password"]').setValue('   ')
    expect(wrapper.get('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('replaces the backend credential template')
    await wrapper.get('[data-testid="deploy-vault-override"]').setValue(false)
    expect(wrapper.get('[data-testid="deploy-submit"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').exists()).toBe(false)
  })

  it('hides team_count field when mode is not gamenet', async () => {
    globalThis.fetch = fetchMockHosts()
    const wrapper = mount(DeployForm, {
      props: baseProps({ gamenet: false }),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="deploy-field-team-count"]').exists()).toBe(false)
  })

  it('sends team_count 1 for a non-gamenet deploy', async () => {
    // The field is hidden, but DeploymentCreate requires team_count — omitting
    // it made every non-gamenet deploy fail validation with a 422.
    const fetchSpy = fetchMockHosts()
    globalThis.fetch = fetchSpy
    const router = makeRouter()
    const wrapper = mount(DeployForm, {
      props: baseProps({ gamenet: false }),
      global: { plugins: [router, makeI18n()] },
    })
    await flushPromises()
    await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('alpha')
    await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
    await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host-1')
    await wrapper.get('[data-testid="deploy-vault-override"]').setValue(true)
    await wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').setValue('s3cret')
    await wrapper.find('[data-testid="deploy-sha-ack"] input').setValue(true)
    await flushPromises()
    await wrapper.find('[data-testid="deploy-submit"]').trigger('click')
    await flushPromises()
    const postCall = fetchSpy.mock.calls.find(c =>
      String(c[0]).endsWith('/v1/deployments') && c[1]?.method === 'POST')
    expect(postCall).toBeTruthy()
    expect(JSON.parse(postCall[1].body).team_count).toBe(1)
  })

  it('posts no body to /validate — the endpoint declares no request model', async () => {
    const fetchSpy = fetchMockHosts()
    globalThis.fetch = fetchSpy
    const wrapper = mount(DeployForm, {
      props: baseProps({ projectSha: '' }),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('alpha')
    await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
    await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host-1')
    await wrapper.find('[data-testid="deploy-field-team-count"] input').setValue(2)
    await wrapper.get('[data-testid="deploy-vault-override"]').setValue(true)
    await wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').setValue('s3cret')
    await flushPromises()
    await wrapper.find('[data-testid="deploy-run-preflight"]').trigger('click')
    await flushPromises()
    const validateCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/validate'))
    expect(validateCall).toBeTruthy()
    expect(validateCall[1]?.body).toBeUndefined()
  })

  it('shows soft-warn checkbox and allows deploy only after ack', async () => {
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('/v1/proxmox/hosts') && (!opts || opts.method !== 'POST')) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'host-1', name: 'pve01' }], total: 1, offset: 0, limit: 100 }) }
      }
      if (String(url).includes('/validate')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: false, blocking: false,
            checks: [{ check: 'ip_overlap', result: 'warn', detail: 'soft warn' }],
            generated_at: '2026-04-14T12:00:00Z',
          }),
        }
      }
      if (String(url).endsWith('/v1/deployments') && opts?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'dep-new' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    const wrapper = mount(DeployForm, {
      props: baseProps({ projectSha: '' }),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('alpha')
    await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
    await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host-1')
    await wrapper.find('[data-testid="deploy-field-team-count"] input').setValue(2)
    await wrapper.get('[data-testid="deploy-vault-override"]').setValue(true)
    await wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').setValue('s3cret')
    await wrapper.find('[data-testid="deploy-sha-ack"] input').setValue(true)
    await wrapper.find('[data-testid="deploy-run-preflight"]').trigger('click')
    await flushPromises()
    // warn now displayed, needs ack
    expect(wrapper.find('[data-testid="deploy-preflight-warn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="deploy-warn-ack"] input').setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeUndefined()
  })
})


async function validForm(overrides = {}) {
  const router = makeRouter()
  const wrapper = mount(DeployForm, {
    props: baseProps({ gamenet: false, ...overrides }),
    global: { plugins: [router, makeI18n()] },
  })
  await flushPromises()
  await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('alpha')
  await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
  await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host-1')
  await wrapper.get('[data-testid="deploy-vault-override"]').setValue(true)
  await wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').setValue('vault-password')
  await wrapper.find('[data-testid="deploy-sha-ack"] input').setValue(true)
  return { wrapper, router }
}

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

function pendingResponse() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

describe('DeployForm backend integration', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses selected backend credentials for hosts, project validation and deployment', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://api.range42.test/', token: 'gateway-token' })
    const fetch = fetchMockHosts()
    vi.stubGlobal('fetch', fetch)
    const { wrapper } = await validForm({ projectSha: '' })
    await wrapper.find('[data-testid="deploy-run-preflight"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="deploy-submit"]').trigger('click')
    await flushPromises()
    expect(fetch.mock.calls).toHaveLength(3)
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toMatch(/^https:\/\/api.range42.test\/v1\//)
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer gateway-token')
    }
  })

  it('defers pinned concrete scenario checks to deployment preflight without legacy project validation', async () => {
    const fetch = fetchMockHosts()
    vi.stubGlobal('fetch', fetch)
    const { wrapper } = await validForm()
    await wrapper.find('[data-testid="deploy-field-scenario"] input').trigger('blur')
    await flushPromises()
    expect(wrapper.find('[data-testid="deploy-run-preflight"]').exists()).toBe(false)
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/validate'))).toBe(false)
    await wrapper.find('[data-testid="deploy-submit"]').trigger('click')
    await flushPromises()
    const request = fetch.mock.calls.find(([url]) => url.endsWith('/deployments'))
    expect(JSON.parse(request[1].body).project_sha).toBe('eeff0011aabb2233')
  })

  it('loads every host page from Page.items', async () => {
    const fetch = vi.fn(async url => {
      const offset = Number(new URL(url, 'http://ui.test').searchParams.get('offset') || 0)
      return response({
        items: [{ id: `host-${offset + 1}`, name: `pve-${offset + 1}` }],
        offset, limit: 1, total: 2,
      })
    })
    vi.stubGlobal('fetch', fetch)
    const { wrapper } = await validForm()
    expect(wrapper.findAll('[data-testid="deploy-field-host"] option').map(o => o.text()))
      .toEqual(['Select a host', 'pve-1', 'pve-2'])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toContain('offset=1')
  })

  it('shows host errors with retry and blocks stale selections while loading', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ message: 'Host registry unavailable' }, 503))
      .mockResolvedValueOnce(response({ items: [{ id: 'host-1', name: 'pve01' }], total: 1 }))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(DeployForm, {
      props: baseProps(), global: { plugins: [makeRouter(), makeI18n()] },
    })
    expect(wrapper.find('[data-testid="deploy-field-host"] select').attributes('disabled')).toBeDefined()
    await flushPromises()
    expect(wrapper.text()).toContain('Host registry unavailable')
    await wrapper.find('[data-testid="deploy-hosts-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('pve01')
    expect(wrapper.text()).not.toContain('Host registry unavailable')
  })

  it('discards a previous backend host response after switching backends', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old.test' })
    const next = backend.addHost({ url: 'https://new.test' })
    const old = pendingResponse()
    vi.stubGlobal('fetch', vi.fn(url => url.startsWith('https://old.test')
      ? old.promise
      : Promise.resolve(response({ items: [{ id: 'new-host', name: 'New host' }], total: 1 }))))
    const wrapper = mount(DeployForm, {
      props: baseProps(), global: { plugins: [makeRouter(), makeI18n()] },
    })
    backend.setActiveHost(next)
    await flushPromises()
    old.resolve(response({ items: [{ id: 'old-host', name: 'Old host' }], total: 1 }))
    await flushPromises()
    expect(wrapper.text()).toContain('New host')
    expect(wrapper.text()).not.toContain('Old host')
  })

  it.each([0, 1.5, 65])('blocks invalid backend team_count %s', async teamCount => {
    vi.stubGlobal('fetch', fetchMockHosts())
    const { wrapper } = await validForm()
    await wrapper.setProps({ gamenet: true })
    await wrapper.find('[data-testid="deploy-field-team-count"] input').setValue(teamCount)
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
  })

  it('blocks deployment and displays actual project validation errors' , async () => {
    const base = fetchMockHosts()
    vi.stubGlobal('fetch', vi.fn((url, options) => url.endsWith('/validate')
      ? Promise.resolve(response({ ok: false, errors: [{ field: 'nodes.vm.network', reason: 'Network is required' }] }))
      : base(url, options)))
    const { wrapper } = await validForm({ projectSha: '' })
    await wrapper.find('[data-testid="deploy-run-preflight"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Network is required')
    expect(wrapper.text()).toContain('nodes.vm.network')
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
  })

  it('blocks submission during validation and after validation request failure', async () => {
    const base = fetchMockHosts()
    const validation = pendingResponse()
    vi.stubGlobal('fetch', vi.fn((url, options) => url.endsWith('/validate')
      ? validation.promise : base(url, options)))
    const { wrapper } = await validForm({ projectSha: '' })
    await wrapper.find('[data-testid="deploy-run-preflight"]').trigger('click')
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
    validation.resolve(response({ message: 'Project checkout is unavailable' }, 503))
    await flushPromises()
    expect(wrapper.text()).toContain('Project checkout is unavailable')
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
  })

  it('clears target, validation and secret acknowledgements on backend change', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old.test' })
    const next = backend.addHost({ url: 'https://new.test' })
    vi.stubGlobal('fetch', fetchMockHosts())
    const { wrapper } = await validForm()
    backend.setActiveHost(next)
    await flushPromises()
    expect(wrapper.find('[data-testid="deploy-field-host"] select').element.value).toBe('')
    expect(wrapper.find('[data-testid="deploy-field-vault"] input[type="password"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="deploy-vault-override"]').element.checked).toBe(false)
    expect(wrapper.find('[data-testid="deploy-sha-ack"] input').element.checked).toBe(false)
    expect(wrapper.find('[data-testid="deploy-submit"]').attributes('disabled')).toBeDefined()
  })

  it('does not navigate to a deployment created on a backend that is no longer selected', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old.test' })
    const next = backend.addHost({ url: 'https://new.test' })
    const base = fetchMockHosts()
    const creation = pendingResponse()
    vi.stubGlobal('fetch', vi.fn((url, options) => options?.method === 'POST' && url.endsWith('/deployments')
      ? creation.promise : base(url, options)))
    const { wrapper, router } = await validForm()
    const push = vi.spyOn(router, 'push')
    await wrapper.find('[data-testid="deploy-submit"]').trigger('click')
    backend.setActiveHost(next)
    await flushPromises()
    creation.resolve(response({ id: 'old-deployment' }, 201))
    await flushPromises()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(push).not.toHaveBeenCalled()
  })
})

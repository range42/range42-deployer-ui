import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import DeployForm from '@/components/project/DeployForm.vue'
import deploymentEn from '@/locales/en/deployment.json'
import commonEn from '@/locales/en/common.json'

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
    existingCodenames: ['already-taken'],
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
          hosts: [
            { id: 'host-1', name: 'pve01', node_name: 'pve' },
            { id: 'host-2', name: 'pve02', node_name: 'pve' },
          ],
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
    await wrapper.find('[data-testid="deploy-field-vault"] input').setValue('s3cret')
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
    expect(body.codename).toBe('alpha')
    expect(body.scenario_label).toBe('demo_lab')
    expect(body.target_host).toBe('host-1')
    expect(body.team_count).toBe(2)
    expect(body.catalog_sha).toBe('aabbccdd11223344')
    expect(body.project_sha).toBe('eeff0011aabb2233')
    expect(pushSpy).toHaveBeenCalledWith({ name: 'deployment-detail', params: { id: 'dep-new' } })
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

  it('shows soft-warn checkbox and allows deploy only after ack', async () => {
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('/v1/proxmox/hosts') && (!opts || opts.method !== 'POST')) {
        return { ok: true, status: 200, json: async () => ({ hosts: [{ id: 'host-1', name: 'pve01' }] }) }
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
      props: baseProps(),
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    await wrapper.find('[data-testid="deploy-field-codename"] input').setValue('alpha')
    await wrapper.find('[data-testid="deploy-field-scenario"] input').setValue('demo_lab')
    await wrapper.find('[data-testid="deploy-field-host"] select').setValue('host-1')
    await wrapper.find('[data-testid="deploy-field-team-count"] input').setValue(2)
    await wrapper.find('[data-testid="deploy-field-vault"] input').setValue('s3cret')
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

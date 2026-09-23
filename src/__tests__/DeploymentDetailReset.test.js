import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import DeploymentDetail from '@/views/DeploymentDetail.vue'
import deploymentEn from '@/locales/en/deployment.json'
import commonEn from '@/locales/en/common.json'
import { useDeploymentStore, applySseEvent } from '@/stores/deploymentStore.ts'

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

describe('<DeploymentDetail> — per-team reset (C4.9)', () => {
  let originalFetch
  beforeEach(() => {
    setActivePinia(createPinia())
    originalFetch = globalThis.fetch
  })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('queued reset surfaces Queued pill on the team card', async () => {
    const fetchSpy = vi.fn(async (url, opts) => {
      const u = String(url)
      if (u.endsWith('/v1/deployments/d-Q') && (!opts || opts.method === 'GET' || !opts.method)) {
        return { ok: true, status: 200, json: async () => ({ id: 'd-Q', team_count: 2, state: 'deploying', codename: 'qq' }) }
      }
      if (u.includes('/teams/team-1/reset')) {
        return { ok: true, status: 202, json: async () => ({ queued: true }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    globalThis.fetch = fetchSpy
    const router = makeRouter()
    router.push('/deployments/d-Q')
    await router.isReady()
    const wrapper = mount(DeploymentDetail, {
      global: { plugins: [router, makeI18n()] },
    })
    await settle(wrapper)
    // Feed a task_start so team-1 appears + deployment in in-flight state.
    const store = useDeploymentStore()
    applySseEvent(store.getOrCreateRecord('d-Q'), {
      event_type: 'state_transition', event_seq: 1, payload: { to: 'deploying' },
    })
    applySseEvent(store.getOrCreateRecord('d-Q'), {
      event_type: 'task_start', event_seq: 2,
      payload: { task_name: 't', team_id: 'team-1' },
    })
    await flushPromises()
    // Switch to teams tab
    await wrapper.find('[data-testid="tab-teams"]').trigger('click')
    await flushPromises()
    // Open action menu on the first card
    const menuBtn = wrapper.find('[data-testid="team-card"] button[aria-label="Team actions"]')
    await menuBtn.trigger('click')
    const resetMenuItem = wrapper.findAll('[role="menuitem"]').find(b => b.text() === 'Reset team')
    expect(resetMenuItem).toBeTruthy()
    await resetMenuItem.trigger('click')
    await flushPromises()
    // The reset modal should show the queue-notice because state='deploying'
    const queueNotice = wrapper.find('[data-testid="reset-queue-notice"]')
    expect(queueNotice.exists()).toBe(true)
    // Confirm queued reset
    await wrapper.find('[data-testid="reset-confirm"]').trigger('click')
    await flushPromises()
    // Now the team card should show a Queued pill
    expect(wrapper.find('[data-testid="team-card-queued"]').exists()).toBe(true)
    // Verify POST URL carried queue=true
    const postCall = fetchSpy.mock.calls.find(c =>
      String(c[0]).includes('/teams/team-1/reset') && c[1]?.method === 'POST'
    )
    expect(postCall).toBeTruthy()
    expect(String(postCall[0])).toContain('queue=true')
  })
})

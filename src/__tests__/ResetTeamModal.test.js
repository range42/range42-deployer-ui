import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ResetTeamModal from '@/components/ResetTeamModal.vue'
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

describe('<ResetTeamModal>', () => {
  let originalFetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('POSTs /v1/deployments/:id/teams/:n/reset when in-flight=false', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    globalThis.fetch = fetchSpy
    const wrapper = mount(ResetTeamModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-3', inFlight: false },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('[data-testid="reset-confirm"]').trigger('click')
    await flushPromises()
    const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('/teams/team-3/reset'))
    expect(call).toBeTruthy()
    expect(call[1].method).toBe('POST')
    // Not queued — no ?queue=true
    expect(String(call[0])).not.toContain('queue=true')
  })

  it('POSTs with queue=true when in-flight=true and shows queued label', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ queued: true }) }))
    globalThis.fetch = fetchSpy
    const wrapper = mount(ResetTeamModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-2', inFlight: true },
      global: { plugins: [makeI18n()] },
    })
    // Expect queued-variant button text
    const btn = wrapper.find('[data-testid="reset-confirm"]')
    expect(btn.text().toLowerCase()).toContain('queue')
    await btn.trigger('click')
    await flushPromises()
    const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('/teams/team-2/reset'))
    expect(call).toBeTruthy()
    expect(String(call[0])).toContain('queue=true')
  })

  it('emits close when cancel clicked', async () => {
    const wrapper = mount(ResetTeamModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-1', inFlight: false },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('[data-testid="reset-cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits queued event with teamId after a queued POST', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ queued: true }) }))
    globalThis.fetch = fetchSpy
    const wrapper = mount(ResetTeamModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-7', inFlight: true },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('[data-testid="reset-confirm"]').trigger('click')
    await flushPromises()
    const events = wrapper.emitted('queued') || []
    expect(events.length).toBe(1)
    expect(events[0][0]).toEqual({ teamId: 'team-7' })
  })
})

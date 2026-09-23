import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import SnapshotCreateModal from '@/components/SnapshotCreateModal.vue'
import RollbackModal from '@/components/RollbackModal.vue'
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

describe('<SnapshotCreateModal>', () => {
  let originalFetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('POSTs /v1/deployments/:id/snapshot with scope=team', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'snap-1' }) }))
    globalThis.fetch = fetchSpy
    const wrapper = mount(SnapshotCreateModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-3' },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('[data-testid="snapshot-name"] input').setValue('pre-ops-001')
    await wrapper.find('[data-testid="snapshot-create"]').trigger('click')
    await flushPromises()
    const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('/v1/deployments/d-1/snapshot'))
    expect(call).toBeTruthy()
    const body = JSON.parse(call[1].body)
    expect(body).toEqual({ scope: 'team', team_id: 'team-3', name: 'pre-ops-001' })
  })

  it('disables create when name empty', () => {
    const wrapper = mount(SnapshotCreateModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-1' },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="snapshot-create"]').attributes('disabled')).toBeDefined()
  })
})

describe('<RollbackModal>', () => {
  let originalFetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('lists snapshots and POSTs rollback with chosen snapshot', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    globalThis.fetch = fetchSpy
    const wrapper = mount(RollbackModal, {
      props: {
        visible: true,
        deploymentId: 'd-2',
        teamId: 'team-1',
        snapshots: [
          { name: 'snap-A', created_at: '2026-04-14T10:00Z' },
          { name: 'snap-B', created_at: '2026-04-14T11:00Z' },
        ],
      },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('[data-testid="rollback-select"]').setValue('snap-A')
    await wrapper.find('[data-testid="rollback-confirm"]').trigger('click')
    await flushPromises()
    const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('/v1/deployments/d-2/rollback'))
    expect(call).toBeTruthy()
    const body = JSON.parse(call[1].body)
    expect(body).toEqual({ scope: 'team', team_id: 'team-1', snapshot_name: 'snap-A' })
  })

  it('shows missing snapshots (409) and offers partial rollback', async () => {
    let callCount = 0
    const fetchSpy = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        return {
          ok: false, status: 409,
          json: async () => ({
            error: 'SNAPSHOT_MISSING',
            details: [
              { vm_id: 101, snapshot: 'snap-A' },
              { vm_id: 102, snapshot: 'snap-A' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ partial: true }) }
    })
    globalThis.fetch = fetchSpy
    const wrapper = mount(RollbackModal, {
      props: {
        visible: true,
        deploymentId: 'd-3',
        teamId: 'team-1',
        snapshots: [{ name: 'snap-A', created_at: '2026-04-14T10:00Z' }],
      },
      global: { plugins: [makeI18n()] },
    })
    await wrapper.find('[data-testid="rollback-select"]').setValue('snap-A')
    await wrapper.find('[data-testid="rollback-confirm"]').trigger('click')
    await flushPromises()
    // Missing panel surfaces
    const missing = wrapper.find('[data-testid="rollback-missing"]')
    expect(missing.exists()).toBe(true)
    expect(missing.text()).toContain('101')
    expect(missing.text()).toContain('102')
    // Partial button
    const partialBtn = wrapper.find('[data-testid="rollback-partial"]')
    expect(partialBtn.exists()).toBe(true)
    await partialBtn.trigger('click')
    await flushPromises()
    const partialCall = fetchSpy.mock.calls.find(c => {
      if (!String(c[0]).includes('/v1/deployments/d-3/rollback')) return false
      try {
        const b = JSON.parse(c[1].body)
        return b.partial === true
      } catch { return false }
    })
    expect(partialCall).toBeTruthy()
  })

  it('shows empty state when no snapshots', () => {
    const wrapper = mount(RollbackModal, {
      props: { visible: true, deploymentId: 'd-1', teamId: 'team-1', snapshots: [] },
      global: { plugins: [makeI18n()] },
    })
    expect(wrapper.find('[data-testid="rollback-empty"]').exists()).toBe(true)
  })
})

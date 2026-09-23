import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import TeardownConfirmModal from '@/components/TeardownConfirmModal.vue'
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
      { path: '/deployments', name: 'deployments', component: { template: '<div/>' } },
    ],
  })
}

describe('<TeardownConfirmModal>', () => {
  let originalFetch
  beforeEach(() => {
    setActivePinia(createPinia())
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('destroy button is disabled until codename is typed exactly', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const wrapper = mount(TeardownConfirmModal, {
      props: { visible: true, deploymentId: 'd-1', codename: 'alpha-bravo' },
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await flushPromises()
    const destroyBtn = wrapper.find('[data-testid="teardown-destroy"]')
    expect(destroyBtn.attributes('disabled')).toBeDefined()
    // wrong value
    await wrapper.find('[data-testid="teardown-input"]').setValue('alpha-brav')
    expect(destroyBtn.attributes('disabled')).toBeDefined()
    // exact value
    await wrapper.find('[data-testid="teardown-input"]').setValue('alpha-bravo')
    await flushPromises()
    expect(destroyBtn.attributes('disabled')).toBeUndefined()
  })

  it('uses alertdialog role', () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const wrapper = mount(TeardownConfirmModal, {
      props: { visible: true, deploymentId: 'd-1', codename: 'alpha' },
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true)
  })

  it('DELETE /v1/deployments/:id with {confirm} body on destroy', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }))
    globalThis.fetch = fetchSpy
    const router = makeRouter()
    const pushSpy = vi.spyOn(router, 'push')
    const wrapper = mount(TeardownConfirmModal, {
      props: { visible: true, deploymentId: 'dep-XYZ', codename: 'alpha' },
      global: { plugins: [router, makeI18n()] },
    })
    await wrapper.find('[data-testid="teardown-input"]').setValue('alpha')
    await flushPromises()
    await wrapper.find('[data-testid="teardown-destroy"]').trigger('click')
    await flushPromises()
    expect(fetchSpy).toHaveBeenCalled()
    const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('/v1/deployments/dep-XYZ'))
    expect(call).toBeTruthy()
    expect(call[1].method).toBe('DELETE')
    expect(JSON.parse(call[1].body)).toEqual({ confirm: 'alpha' })
    expect(pushSpy).toHaveBeenCalledWith({ name: 'deployments' })
  })

  it('emits close when cancel clicked', async () => {
    const wrapper = mount(TeardownConfirmModal, {
      props: { visible: true, deploymentId: 'd-1', codename: 'alpha' },
      global: { plugins: [makeRouter(), makeI18n()] },
    })
    await wrapper.find('[data-testid="teardown-cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})

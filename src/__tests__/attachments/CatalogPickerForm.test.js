import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import CatalogPickerForm from '@/components/project/attachments/sources/CatalogPickerForm.vue'

enableAutoUnmount(afterEach)

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackWarn: false,
    missingWarn: false,
    messages: { en: {} },
  })
}

const ANSIBLE_ROLE_RESPONSE = {
  ok: true,
  json: async () => ({
    items: [
      {
        kind: 'ansible_role',
        name: 'Install Wazuh',
        source_id: 'src-a',
        path: 'roles/wazuh',
        sha: 'abc',
      },
    ],
    total: 1,
    offset: 0,
    limit: 200,
  }),
}

describe('CatalogPickerForm', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    globalThis.fetch = () => Promise.resolve(ANSIBLE_ROLE_RESPONSE)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('calls fetch with kind=ansible_role for catalog_role source and renders the entry row', async () => {
    let capturedUrl = null
    globalThis.fetch = (url) => {
      capturedUrl = url
      return Promise.resolve(ANSIBLE_ROLE_RESPONSE)
    }

    const wrapper = mount(CatalogPickerForm, {
      props: { source: { kind: 'catalog_role' } },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()

    expect(capturedUrl).toContain('kind=ansible_role')
    expect(wrapper.find('[data-testid="catalog-pick-src-a:roles/wazuh"]').exists()).toBe(true)
  })

  it('emits update:source with correct ref and sha when a row is clicked', async () => {
    const wrapper = mount(CatalogPickerForm, {
      props: { source: { kind: 'catalog_role' } },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()

    await wrapper.find('[data-testid="catalog-pick-src-a:roles/wazuh"]').trigger('click')

    const emitted = wrapper.emitted('update:source')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0]).toEqual({
      kind: 'catalog_role',
      ref: 'src-a:roles/wazuh',
      sha: 'abc',
    })
  })

  it('calls fetch with kind=container for catalog_container source', async () => {
    let capturedUrl = null
    globalThis.fetch = (url) => {
      capturedUrl = url
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      })
    }

    mount(CatalogPickerForm, {
      props: { source: { kind: 'catalog_container' } },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()

    expect(capturedUrl).toContain('kind=container')
  })

  it('shows loading state while fetching', async () => {
    let resolve
    globalThis.fetch = () =>
      new Promise((r) => {
        resolve = r
      })

    const wrapper = mount(CatalogPickerForm, {
      props: { source: { kind: 'catalog_role' } },
      global: { plugins: [makeI18n()] },
    })

    // Before fetch resolves, loading should be shown.
    expect(wrapper.find('[data-testid="catalog-pick-loading"]').exists()).toBe(true)

    resolve(ANSIBLE_ROLE_RESPONSE)
    await flushPromises()

    expect(wrapper.find('[data-testid="catalog-pick-loading"]').exists()).toBe(false)
  })

  it('shows empty state when entries list is empty', async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      })

    const wrapper = mount(CatalogPickerForm, {
      props: { source: { kind: 'catalog_role' } },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="catalog-pick-empty"]').exists()).toBe(true)
    })
  })

  it('highlights the currently-selected row', async () => {
    const wrapper = mount(CatalogPickerForm, {
      props: {
        source: { kind: 'catalog_role', ref: 'src-a:roles/wazuh' },
      },
      global: { plugins: [makeI18n()] },
    })
    await flushPromises()

    const row = wrapper.find('[data-testid="catalog-pick-src-a:roles/wazuh"]')
    expect(row.classes()).toContain('ring')
  })
})

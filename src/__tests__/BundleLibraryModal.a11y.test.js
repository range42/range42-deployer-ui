import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import BundleLibraryModal from '@/components/project/BundleLibraryModal.vue'
import bundles from '@/locales/en/bundles.json'

vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/composables/useCatalog', () => ({ useCatalog: () => ({ listEntries: vi.fn().mockResolvedValue([]), error: { value: null } }) }))
enableAutoUnmount(afterEach)

it('focuses the teleported library dialog and handles keyboard dismissal', async () => {
  localStorage.clear()
  const wrapper = mount(BundleLibraryModal, { attachTo: document.body,
    props: { open: true, vms: [] },
    global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: { bundles } } })] } })
  await flushPromises()
  const dialog = document.querySelector('[aria-labelledby="bundle-library-title"]')
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.contains(document.activeElement)).toBe(true)
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(wrapper.emitted('close')).toHaveLength(1)
})

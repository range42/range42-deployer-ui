import { afterEach, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import publishing from '@/locales/en/publishing.json'

vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/composables/useCatalogSources', () => ({
  useCatalogSources: () => ({ loadSources: vi.fn().mockResolvedValue(undefined), loading: false }),
}))
enableAutoUnmount(afterEach)

it('mounts the real focus trap after its dialog exists and supports keyboard dismissal', async () => {
  localStorage.clear()
  const wrapper = mount(PublishTargetsModal, {
    attachTo: document.body,
    props: { open: true, projectId: 'draft-role', files: { 'tasks/main.yml': '[]' }, message: 'Add role' },
    global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'en', messages: { en: { publishing } } })] },
  })

  await flushPromises()

  const dialog = wrapper.get('[role="dialog"]')
  expect(dialog.attributes('aria-modal')).toBe('true')
  expect(wrapper.get('#publish-title').text()).toBe('Publish Git content')
  expect(dialog.element.contains(document.activeElement)).toBe(true)
  await dialog.trigger('keydown', { key: 'Escape' })
  expect(wrapper.emitted('close')).toHaveLength(1)
})

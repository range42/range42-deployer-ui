import { expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import Sidebar from '@/components/Sidebar.vue'
import sidebar from '@/locales/en/sidebar.json'
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn(), setLocale: vi.fn() }))
it.each([{ name: 'Blank', nodes: [] }, { name: 'Existing', nodes: [{ id: 'old', type: 'vm' }] }])('adds a stack from project tools in $name', async project => {
  const wrapper = shallowMount(Sidebar, { props: { project }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { sidebar } } })] } })
  try {
    const scenarios = wrapper.find('[data-testid="add-native-scenario"]')
    expect(scenarios.text()).toContain('Add scenario')
    await scenarios.trigger('click')
    expect(wrapper.emitted('openNativeScenarios')).toHaveLength(1)
    const button = wrapper.find('[data-testid="add-platform-stack"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('openPlatformStack')).toHaveLength(1)
  } finally { wrapper.unmount() }
})

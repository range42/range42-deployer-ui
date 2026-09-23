import { expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import Sidebar from '@/components/Sidebar.vue'
import sidebar from '@/locales/en/sidebar.json'
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn(), setLocale: vi.fn() }))

it('offers deployment without controls that only edit generated topology', async () => {
  const wrapper = shallowMount(Sidebar, { props: { project: { name: 'Native lab', native_scenario: { version: 1, path: 'training/lab' } } },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { sidebar } } })] } })
  try {
    expect(wrapper.findAll('[draggable="true"]')).toHaveLength(0)
    expect(wrapper.findAll('button').some(button => button.text() === sidebar.validate)).toBe(false)
    const deploy = wrapper.findAll('button').find(button => button.text() === sidebar.deploy)!
    await deploy.trigger('click')
    expect(wrapper.emitted('openDeploy')).toHaveLength(1)
  } finally { wrapper.unmount() }
})

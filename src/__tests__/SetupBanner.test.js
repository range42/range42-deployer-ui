import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import SetupBanner from '@/components/ui/SetupBanner.vue'
import homeEn from '@/locales/en/home.json'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

function mountBanner() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { home: homeEn } },
  })
  return mount(SetupBanner, { global: { plugins: [pinia, i18n] } })
}

function completeSetup() {
  useInventoryStore().addSource({ id: 's1', type: 'github' })
  useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
}

describe('SetupBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('shows while setup is incomplete', () => {
    const wrapper = mountBanner()
    expect(wrapper.find('[data-testid="setup-banner"]').exists()).toBe(true)
  })

  it('hides once setup is complete', () => {
    setActivePinia(createPinia())
    completeSetup()
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { home: homeEn } } })
    const wrapper = mount(SetupBanner, { global: { plugins: [i18n] } })
    expect(wrapper.find('[data-testid="setup-banner"]').exists()).toBe(false)
  })

  it('emits open when "Open setup" is clicked', async () => {
    const wrapper = mountBanner()
    await wrapper.find('button.btn-primary').trigger('click')
    expect(wrapper.emitted('open')).toBeTruthy()
  })

  it('hides and persists dismissal when dismissed', async () => {
    const wrapper = mountBanner()
    await wrapper.find('[data-testid="setup-banner-dismiss"]').trigger('click')
    expect(wrapper.find('[data-testid="setup-banner"]').exists()).toBe(false)
    expect(localStorage.getItem('range42_setup_banner_dismissed')).toBe('1')
  })
})

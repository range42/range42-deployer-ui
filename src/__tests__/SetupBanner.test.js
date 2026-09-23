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
  useBackendApiStore().addHost({ url: 'http://h1:8000', nodeName: 'pve' })
  const inv = useInventoryStore()
  inv.sourcesBackendScope = 'http://h1:8000'
  inv.addSource({ id: 's1', repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main', last_refreshed_at: '2026-09-10T09:00:00Z' }] })
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

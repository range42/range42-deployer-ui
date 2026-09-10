import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import BackendAccessPanel from '@/components/ui/BackendAccessPanel.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import commonEn from '@/locales/en/common.json'

vi.mock('@/i18n', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))
const response = (status, body = {}) => new Response(JSON.stringify(body), { status })
let wrapper
let fetchMock
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useBackendApiStore().seedDefaultHost({ defaultBackendUrl: 'https://lab.test', defaultNodeName: 'pve01' })
  fetchMock = vi.fn().mockResolvedValue(response(401))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
async function show() {
  wrapper = mount(BackendAccessPanel, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { common: commonEn } } })] } })
  await flushPromises()
}
describe('fresh browser backend connection', () => {
  it('prompts for the backend token after checking the seeded host', async () => {
    await show()
    expect(wrapper.text()).toContain('Connect to your backend')
    expect(wrapper.text()).toContain('https://lab.test')
    expect(wrapper.get('input').attributes('type')).toBe('password')
    expect(wrapper.text()).toContain('Git')
  })
  it('verifies a supplied token, closes the prompt and remembers the connection', async () => {
    await show()
    fetchMock.mockImplementation(() => Promise.resolve(response(200, { ready: true })))
    await wrapper.get('input').setValue('operator-token')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(useBackendApiStore().token).toBe('operator-token')
    expect(wrapper.find('form').exists()).toBe(false)
  })
  it('keeps rejected tokens editable and reports the rejection', async () => {
    await show()
    await wrapper.get('input').setValue('bad-token')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('rejected')
    expect(useBackendApiStore().token).toBeUndefined()
  })
  it('accepts an explicitly unauthenticated development backend', async () => {
    fetchMock.mockResolvedValue(response(200, { ready: true }))
    await show()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(useBackendApiStore().isHealthy).toBe(true)
  })
})

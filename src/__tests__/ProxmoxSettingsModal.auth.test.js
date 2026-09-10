import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProxmoxSettingsModal from '@/components/ProxmoxSettingsModal.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

let wrapper
let backend
let fetchMock
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  backend = useBackendApiStore()
  backend.addHost({ url: 'https://lab.test', token: 'operator-token', nodeName: 'pve01' })
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
async function show() {
  wrapper = mount(ProxmoxSettingsModal, { props: { visible: true, projectId: 'auth-project' } })
  await flushPromises()
}
async function testConnection() {
  await wrapper.findAll('button').find(button => button.text() === 'Test Connection').trigger('click')
  await flushPromises()
}
describe('project backend connection', () => {
  it('defaults a new project to the active backend and verifies readiness with its token', async () => {
    await show()
    expect(wrapper.find('input').element.value).toBe('https://lab.test')
    await testConnection()
    expect(fetchMock.mock.calls[0][0]).toBe('https://lab.test/v1/health/ready')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer operator-token')
    expect(wrapper.text()).toContain('Backend ready')
  })
  it('never sends a saved token to a manually entered different backend', async () => {
    await show()
    await wrapper.find('input').setValue('https://different.test')
    await testConnection()
    expect(fetchMock.mock.calls[0][0]).toBe('https://different.test/v1/health/ready')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('Authorization')).toBe(false)
  })
  it('explains a missing token and exposes authentication-required state', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    await show()
    await wrapper.find('select').setValue(backend.activeHost.id)
    await testConnection()
    expect(wrapper.text()).toContain('backend API token')
    expect(backend.requiresAuthentication).toBe(true)
  })
})

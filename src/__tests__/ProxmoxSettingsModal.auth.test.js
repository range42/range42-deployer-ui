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
  for (const cookie of document.cookie.split(';')) document.cookie = `${cookie.split('=')[0].trim()}=; Max-Age=0; path=/`
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
  it('persists a verified connection and restores it when the project is reopened', async () => {
    await show()
    await wrapper.findAll('button').find(button => button.text() === 'Save Settings').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('range42_proxmox_settings'))).toMatchObject({
      baseUrl: 'https://lab.test', defaultNode: 'pve01',
    })
    wrapper.unmount()
    setActivePinia(createPinia())
    await show()
    expect(wrapper.get('#proxmox-backend-url').element.value).toBe('https://lab.test')
    expect(wrapper.get('#proxmox-node-name').element.value).toBe('pve01')
    expect(wrapper.text()).toContain('Configured')
  })
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

  it.each(['url', 'node', 'token', 'project', 'closed'])('does not save after the %s changes during verification', async change => {
    await show()
    let finish
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await wrapper.findAll('button').find(button => button.text() === 'Save Settings').trigger('click')
    if (change === 'url') await wrapper.get('#proxmox-backend-url').setValue('https://other.test')
    if (change === 'node') await wrapper.get('#proxmox-node-name').setValue('other-node')
    if (change === 'token') backend.setToken('new-token')
    if (change === 'project') await wrapper.setProps({ projectId: 'other-project' })
    if (change === 'closed') await wrapper.setProps({ visible: false })
    finish(new Response(JSON.stringify({ ready: true }), { status: 200 }))
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(localStorage.getItem('range42_proxmox_settings')).toBeNull()
    expect(wrapper.text()).not.toContain('Backend ready')
  })

  it('does not approve a malformed readiness response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ready: 'false' }), { status: 200 }))
    await show()
    await wrapper.findAll('button').find(button => button.text() === 'Save Settings').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})

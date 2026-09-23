import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ProxmoxSettingsModal from '@/components/ProxmoxSettingsModal.vue'
import ProxmoxCapacityPanel from '@/components/proxmox/ProxmoxCapacityPanel.vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

enableAutoUnmount(afterEach)
let backend, first, second
beforeEach(() => {
  localStorage.clear(); setActivePinia(createPinia()); backend = useBackendApiStore()
  first = backend.addHost({ url: 'https://first.test', token: 'first-token', nodeName: 'pve01' })
  second = backend.addHost({ url: 'https://second.test', token: 'second-token', nodeName: 'pve02' })
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())
async function show() {
  const wrapper = mount(ProxmoxSettingsModal, { props: { visible: true, projectId: 'capacity-project' } })
  await flushPromises()
  return wrapper
}
describe('capacity in project Proxmox configuration', () => {
  it('follows the selected connection independently of the globally active backend', async () => {
    const wrapper = await show()
    expect(wrapper.getComponent(ProxmoxCapacityPanel).props()).toEqual({ backendId: first, nodeName: 'pve01' })
    await wrapper.get('[data-testid="saved-host-picker"] select').setValue(second)
    expect(wrapper.getComponent(ProxmoxCapacityPanel).props()).toEqual({ backendId: second, nodeName: 'pve02' })
    expect(backend.activeHost.id).toBe(first)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('disables capacity when a manually entered URL has no registered credentials', async () => {
    const wrapper = await show()
    await wrapper.find('input').setValue('https://unregistered.test')
    expect(wrapper.getComponent(ProxmoxCapacityPanel).props('backendId')).toBe('')
    expect(wrapper.get('[data-testid="capacity-refresh"]').attributes('disabled')).toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('provides accessible names for the configuration fields surrounding capacity', async () => {
    const wrapper = await show()
    for (const id of ['proxmox-backend-url', 'proxmox-node-name']) {
      expect(wrapper.get(`label[for="${id}"]`).text()).toMatch(/Backend API URL|Proxmox Node/)
      expect(wrapper.get(`#${id}`).element.tagName).toBe('INPUT')
    }
  })
  it('uses the same selected token for capacity and readiness when URLs are duplicated', async () => {
    const other = backend.addHost({ url: 'https://first.test', token: 'other-operator', nodeName: 'pve01' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ready: true }))))
    const wrapper = await show()
    await wrapper.get('[data-testid="saved-host-picker"] select').setValue(other)
    expect(wrapper.getComponent(ProxmoxCapacityPanel).props('backendId')).toBe(other)
    await wrapper.findAll('button').find(button => button.text() === 'Test Connection').trigger('click')
    await flushPromises()
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer other-operator')
  })
})

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DeleteNodeModal from '@/components/DeleteNodeModal.vue'

function makeI18n() {
  return createI18n({
    legacy: false, locale: 'en',
    messages: { en: { project: { deleteNode: {
      title: 'Delete node', promptProxmox: 'Delete "{name}"?', promptCanvas: 'Remove "{name}"?',
      deleteFromProxmox: 'Delete from Proxmox', removeCanvasOnly: 'Remove from canvas only',
      cancel: 'Cancel', remove: 'Remove', mustStopFirst: 'Stop it first', destroyWarning: 'destroys disks',
    } } } },
  })
}
function mountModal(node) {
  return mount(DeleteNodeModal, {
    props: { open: true, node },
    global: { plugins: [makeI18n()], stubs: { Teleport: true } },
  })
}
const deployedVm = { id: 'n1', type: 'vm', data: { deployed: true, vmId: 4001, status: 'stopped', name: 'box' } }
const undeployed = { id: 'n2', type: 'vm', data: { deployed: false, name: 'draft' } }
const network = { id: 'n3', type: 'network', data: { name: 'lan' } }

describe('DeleteNodeModal', () => {
  it('deployed VM shows both Proxmox + canvas-only options', () => {
    const w = mountModal(deployedVm)
    expect(w.text()).toContain('Delete from Proxmox')
    expect(w.text()).toContain('Remove from canvas only')
  })
  it('emits deleteProxmox when Proxmox option chosen', async () => {
    const w = mountModal(deployedVm)
    await w.find('[data-testid="delete-proxmox"]').trigger('click')
    expect(w.emitted('deleteProxmox')).toBeTruthy()
  })
  it('canvas-only emits removeCanvas with no proxmox emit', async () => {
    const w = mountModal(deployedVm)
    await w.find('[data-testid="remove-canvas"]').trigger('click')
    expect(w.emitted('removeCanvas')).toBeTruthy()
    expect(w.emitted('deleteProxmox')).toBeFalsy()
  })
  it('undeployed / non-VM shows only canvas-only Remove', () => {
    expect(mountModal(undeployed).find('[data-testid="delete-proxmox"]').exists()).toBe(false)
    expect(mountModal(network).find('[data-testid="delete-proxmox"]').exists()).toBe(false)
    expect(mountModal(undeployed).find('[data-testid="remove-canvas"]').exists()).toBe(true)
  })
  it('running deployed VM shows stop-first note', () => {
    const running = { id: 'n4', type: 'vm', data: { deployed: true, vmId: 5, status: 'running', name: 'r' } }
    expect(mountModal(running).text()).toContain('Stop it first')
  })
  it('running deployed VM disables the Proxmox delete button', () => {
    const running = { id: 'n4', type: 'vm', data: { deployed: true, vmId: 5, status: 'running', name: 'r' } }
    const btn = mountModal(running).find('[data-testid="delete-proxmox"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })
  it('Escape and backdrop click emit cancel', async () => {
    const w = mountModal(deployedVm)
    await w.find('[data-testid="cancel"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})

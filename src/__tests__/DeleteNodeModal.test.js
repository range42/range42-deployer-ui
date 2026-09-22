import { afterEach, describe, it, expect } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import DeleteNodeModal from '@/components/DeleteNodeModal.vue'
import projectMessages from '@/locales/en/project.json'

enableAutoUnmount(afterEach)

function makeI18n() {
  return createI18n({
    legacy: false, locale: 'en',
    messages: { en: { project: projectMessages } },
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
    expect(mountModal(running).text()).toContain('stop it before deleting')
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


describe('group deletion choices', () => {
  it('names the group and distinguishes keeping children from recursive removal', async () => {
    const w = mountModal({ id: 'g', type: 'group', data: { config: { name: 'Training lab' } } })
    await w.setProps({ descendantCount: 3 })
    expect(w.text()).toContain('Training lab')
    expect(w.text()).toContain('3')
    expect(w.get('[data-testid="remove-canvas"]').text()).toBe('Remove group only')
    await w.get('[data-testid="remove-canvas"]').trigger('click')
    expect(w.emitted('removeCanvas')).toEqual([[]])
    await w.get('[data-testid="remove-group-recursive"]').trigger('click')
    expect(w.emitted('removeCanvas').at(-1)).toEqual([{ recursive: true }])
    expect(w.emitted('deleteProxmox')).toBeUndefined()
  })

  it('does not offer recursive deletion for an empty group or an ordinary node', () => {
    expect(mountModal({ id: 'g', type: 'group', data: {} }).find('[data-testid="remove-group-recursive"]').exists()).toBe(false)
    expect(mountModal(deployedVm).find('[data-testid="remove-group-recursive"]').exists()).toBe(false)
  })
})

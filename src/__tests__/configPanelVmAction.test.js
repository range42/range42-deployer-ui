import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

const { launch } = vi.hoisted(() => ({ launch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/composables/useProxmoxTasks', () => ({ useProxmoxTasks: () => ({ launch }) }))
vi.mock('@/services/proxmox', () => ({
  proxmoxApi: {
    vm: { delete: vi.fn(), start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), stopForce: vi.fn() },
    lxc: { delete: vi.fn() },
    storage: { list: vi.fn().mockResolvedValue([]) },
  },
  proxmoxCache: { invalidate: vi.fn() },
}))
vi.mock('@/services/proxmox/cache', () => ({
  proxmoxCache: {
    invalidate: vi.fn(),
    fetchVms: vi.fn().mockResolvedValue([]),
    getTemplateOptions: () => [],
    templates: { value: [] },
    vmCache: { value: [] },
  },
}))
vi.mock('@/services/proxmox/api', () => ({ getBaseUrl: () => 'http://127.0.0.1:8000', getTaskStatus: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/composables/useTagSync', () => ({ useTagSync: () => ({ syncTags: vi.fn(), pushTags: vi.fn() }) }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))

import ConfigPanel from '@/components/ConfigPanel.vue'
import configPanel from '@/locales/en/configPanel.json'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en: { configPanel } }, missingWarn: false, fallbackWarn: false })
}
function makeDeployedVmNode(status) {
  return { id: 'n1', type: 'vm', data: { deployed: true, vmId: 4001, status, name: 'box' } }
}
function mountPanel(node) {
  return mount(ConfigPanel, {
    props: { node },
    global: {
      plugins: [makeI18n()],
      renderStubDefaultSlot: true,
      stubs: {
        NodeAttachmentsSection: true, ApplyChangesDialog: true, AppIcon: true,
        FormField: true, FormSection: true, FormDivider: true, FormList: true,
        DeleteNodeModal: true, Teleport: true,
      },
    },
  })
}

describe('ConfigPanel — lifecycle actions route through task core (no optimistic flip)', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('stop → calls launch("stop", …) and does NOT synchronously set status', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('stop')
    await flushPromises()
    expect(launch).toHaveBeenCalledOnce()
    expect(launch.mock.calls[0][0]).toBe('stop')
    expect(node.data.status).toBe('running')
  })

  it('start → calls launch("start", …)', async () => {
    const node = makeDeployedVmNode('stopped')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('start')
    await flushPromises()
    expect(launch).toHaveBeenCalledWith('start', expect.objectContaining({ vmId: 4001 }))
  })

  it('keeps the LXC guest type in the actual lifecycle API request', async () => {
    const { proxmoxApi } = await import('@/services/proxmox')
    const wrapper = mountPanel({ ...makeDeployedVmNode('stopped'), type: 'lxc' })
    await flushPromises()
    await wrapper.vm.handleVmAction('start')
    const operation = launch.mock.calls[0][1]
    await operation.apiCall()
    expect(proxmoxApi.vm.start).toHaveBeenCalledWith(expect.objectContaining({
      vm_id: 4001, vmtype: 'lxc',
    }))
  })

  it('pause and resume route through launch', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('pause')
    await wrapper.vm.handleVmAction('resume')
    expect(launch.mock.calls.map((c) => c[0])).toEqual(['pause', 'resume'])
  })
  it('presents node context before any editable fields', async () => {
    const wrapper = mountPanel({ id: 'g', type: 'group', data: { config: { name: 'Team' } } })
    await flushPromises()
    const notice = wrapper.find('[data-testid="node-context"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Groups organize')
    const field = wrapper.find('form-field-stub')
    expect(notice.element.compareDocumentPosition(field.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not mutate saved nested node configuration before Save', async () => {
    const node = { id: 'switch', type: 'switch', data: { config: { name: 'Switch', vlans: [] } } }
    const wrapper = mountPanel(node)
    await flushPromises()
    wrapper.findComponent({ name: 'FormList' }).vm.$emit('add')
    await flushPromises()
    expect(node.data.config.vlans).toEqual([])
    await wrapper.vm.handleSave()
    expect(wrapper.emitted('update')[0][1].config.vlans).toHaveLength(1)
  })

  it('recognizes CPU cores from the current VM form when calculating validity', async () => {
    const wrapper = mountPanel({ id: 'vm', type: 'vm', data: { config: { name: 'Guest', cores: 2, memory: 2048 } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Configuration valid')
  })

  it('uses the translated refresh-templates label for keyboard and pointer users', async () => {
    const wrapper = mountPanel({ id: 'vm', type: 'vm', data: { config: { name: 'Guest' } } })
    await flushPromises()
    const button = wrapper.find('[title="Refresh templates from Proxmox"]')
    expect(button.attributes('aria-label')).toBe('Refresh templates from Proxmox')
  })

})

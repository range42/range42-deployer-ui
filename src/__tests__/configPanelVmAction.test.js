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
vi.mock('@/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }))
vi.mock('@/composables/useTagSync', () => ({ useTagSync: () => ({ syncTags: vi.fn(), pushTags: vi.fn() }) }))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn().mockResolvedValue(undefined) }))

import ConfigPanel from '@/components/ConfigPanel.vue'

function makeI18n() {
  return createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
}
function makeDeployedVmNode(status) {
  return { id: 'n1', type: 'vm', data: { deployed: true, vmId: 4001, status, name: 'box' } }
}
function mountPanel(node) {
  return mount(ConfigPanel, {
    props: { node },
    global: {
      plugins: [makeI18n()],
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

  it('pause and resume route through launch', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()
    await wrapper.vm.handleVmAction('pause')
    await wrapper.vm.handleVmAction('resume')
    expect(launch.mock.calls.map((c) => c[0])).toEqual(['pause', 'resume'])
  })
})

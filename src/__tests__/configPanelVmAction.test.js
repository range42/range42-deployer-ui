import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import configPanelEn from '@/locales/en/configPanel.json'
import projectEn from '@/locales/en/project.json'
import commonEn from '@/locales/en/common.json'

// --- Mock the proxmox service: each lifecycle verb resolves successfully ---
// vi.hoisted so these are available inside the hoisted vi.mock factories below.
const { vmApi, cacheInvalidate } = vi.hoisted(() => ({
  vmApi: {
    start: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue({}),
    pause: vi.fn().mockResolvedValue({}),
    resume: vi.fn().mockResolvedValue({}),
    stopForce: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  cacheInvalidate: vi.fn(),
}))

vi.mock('@/services/proxmox', () => ({
  proxmoxApi: { vm: vmApi, storage: { list: vi.fn().mockResolvedValue([]) } },
  proxmoxCache: {
    invalidate: cacheInvalidate,
    fetchVms: vi.fn().mockResolvedValue([]),
    getTemplateOptions: () => [],
    templates: { value: [] },
    vmCache: { value: [] },
  },
}))
vi.mock('@/services/proxmox/cache', () => ({
  proxmoxCache: {
    invalidate: cacheInvalidate,
    fetchVms: vi.fn().mockResolvedValue([]),
    getTemplateOptions: () => [],
    templates: { value: [] },
    vmCache: { value: [] },
  },
}))
vi.mock('@/services/proxmox/api', () => ({ getBaseUrl: () => 'http://127.0.0.1:8000' }))

// Heavy/irrelevant composables stubbed to keep the mount lightweight.
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}))
vi.mock('@/composables/useTagSync', () => ({
  useTagSync: () => ({ pushTags: vi.fn() }),
}))
vi.mock('@/i18n/index.js', () => ({ ensureNamespaces: vi.fn().mockResolvedValue() }))

import ConfigPanel from '@/components/ConfigPanel.vue'

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en: { configPanel: configPanelEn, project: projectEn, common: commonEn } },
  })
}

function makeDeployedVmNode(status) {
  return {
    id: 'vm-1',
    type: 'vm',
    data: {
      type: 'vm',
      label: 'web-01',
      vmId: 105,
      deployed: true,
      status,
      config: { name: 'web-01', vmid: 105 },
      desiredConfig: { name: 'web-01', cores: 2, memory: 2048, description: '' },
      actualConfig: { name: 'web-01', cores: 2, memory: 2048, description: '' },
    },
  }
}

function mountPanel(node) {
  return mount(ConfigPanel, {
    props: { node },
    global: {
      plugins: [makeI18n()],
      stubs: {
        NodeAttachmentsSection: true,
        ApplyChangesDialog: true,
        AppIcon: true,
        FormField: true,
        FormSection: true,
        FormDivider: true,
        FormList: true,
      },
    },
  })
}

describe('ConfigPanel — optimistic VM status after lifecycle action (#80)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('stop → sets node.data.status to "stopped" immediately', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('stop')
    await flushPromises()

    expect(vmApi.stop).toHaveBeenCalledOnce()
    expect(node.data.status).toBe('stopped')
  })

  it('start → sets node.data.status to "running" immediately', async () => {
    const node = makeDeployedVmNode('stopped')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('start')
    await flushPromises()

    expect(vmApi.start).toHaveBeenCalledOnce()
    expect(node.data.status).toBe('running')
  })

  it('pause → sets node.data.status to "paused" immediately', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('pause')
    await flushPromises()

    expect(vmApi.pause).toHaveBeenCalledOnce()
    expect(node.data.status).toBe('paused')
  })

  it('resume → sets node.data.status to "running" immediately', async () => {
    const node = makeDeployedVmNode('paused')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('resume')
    await flushPromises()

    expect(vmApi.resume).toHaveBeenCalledOnce()
    expect(node.data.status).toBe('running')
  })

  it('restart → sets node.data.status to "running" immediately', async () => {
    vi.useFakeTimers()
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()

    const p = wrapper.vm.handleVmAction('restart')
    await vi.runAllTimersAsync()
    await p
    vi.useRealTimers()
    await flushPromises()

    expect(vmApi.stop).toHaveBeenCalledOnce()
    expect(vmApi.start).toHaveBeenCalledOnce()
    expect(node.data.status).toBe('running')
  })

  it('force-stop → sets node.data.status to "stopped" immediately', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('force-stop')
    await flushPromises()

    expect(vmApi.stopForce).toHaveBeenCalledOnce()
    expect(node.data.status).toBe('stopped')
  })

  it('still invalidates the proxmox cache on success', async () => {
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('stop')
    await flushPromises()

    expect(cacheInvalidate).toHaveBeenCalled()
  })

  it('does NOT change status when the action fails', async () => {
    vmApi.stop.mockRejectedValueOnce(new Error('boom'))
    const node = makeDeployedVmNode('running')
    const wrapper = mountPanel(node)
    await flushPromises()

    await wrapper.vm.handleVmAction('stop')
    await flushPromises()

    expect(node.data.status).toBe('running')
  })
})

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
import { proxmoxCache } from '@/services/proxmox/cache'

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
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); proxmoxCache.templates.value = [] })

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

  it('prefills canonical VM resources and saves their original field names', async () => {
    const config = { name: 'Catalog guest', cores: 6, memory_mb: 6144, disk_gb: 48 }
    const node = { id: 'vm', type: 'vm', data: { config } }
    const wrapper = mountPanel(node)
    await flushPromises()
    const field = label => wrapper.findAllComponents({ name: 'FormField' }).find(item => item.props('label') === label)
    expect(field('CPU Cores').props('modelValue')).toBe(6)
    expect(field('Memory (MB)').props('modelValue')).toBe(6144)
    expect(field('Disk').props('modelValue')).toBe('48G')
    expect(wrapper.text()).toContain('Configuration valid')
    await wrapper.vm.handleSave()
    expect(wrapper.emitted('update')[0][1].config).toMatchObject(config)
    expect(wrapper.emitted('update')[0][1].config).not.toHaveProperty('memory')
    expect(wrapper.emitted('update')[0][1].config).not.toHaveProperty('diskSize')
    expect(node.data.config).toEqual(config)
    wrapper.unmount()
  })

  it.each([false, true])('edits canonical resources without retaining conflicting UI aliases (duplicates: %s)', async duplicates => {
    const config = { name: 'Catalog guest', cores: 6, memory_mb: 6144, disk_gb: 48,
      ...(duplicates ? { memory: 1024, diskSize: '16G' } : {}) }
    const wrapper = mountPanel({ id: 'vm', type: 'vm', data: { config } })
    await flushPromises()
    const field = label => wrapper.findAllComponents({ name: 'FormField' }).find(item => item.props('label') === label)
    field('Memory (MB)').vm.$emit('update:modelValue', 8192)
    field('Disk').vm.$emit('update:modelValue', '64GiB')
    await flushPromises()
    await wrapper.vm.handleSave()
    const saved = wrapper.emitted('update')[0][1].config
    expect(saved).toMatchObject({ memory_mb: 8192, disk_gb: 64 })
    expect(saved).not.toHaveProperty('memory')
    expect(saved).not.toHaveProperty('diskSize')
    expect(config.memory_mb).toBe(6144)
    expect(config.disk_gb).toBe(48)
    wrapper.unmount()
  })

  it.each([
    { memory: 6144, diskSize: '48G' },
    { memory_mb: 6144, disk_gb: 48 },
  ])('preserves configured resources on hydration and fills only explicitly selected templates: %j', async resources => {
    proxmoxCache.templates.value = [
      { vmid: 9901, maxcpu: 2, maxmem: 2048 * 1024 * 1024 },
      { vmid: 9902, maxcpu: 4, maxmem: 4096 * 1024 * 1024 },
    ]
    const config = { name: 'Configured guest', template: '9901', cores: 6, ...resources }
    const wrapper = mountPanel({ id: 'vm', type: 'vm', data: { config } })
    await flushPromises()
    const field = label => wrapper.findAllComponents({ name: 'FormField' }).find(item => item.props('label') === label)
    expect(field('CPU Cores').props('modelValue')).toBe(6)
    expect(field('Memory (MB)').props('modelValue')).toBe(6144)
    field('Clone from template').vm.$emit('update:modelValue', '9902')
    await flushPromises()
    expect(field('CPU Cores').props('modelValue')).toBe(4)
    expect(field('Memory (MB)').props('modelValue')).toBe(4096)
    await wrapper.vm.handleSave()
    const saved = wrapper.emitted('update')[0][1].config
    expect(saved[Object.hasOwn(resources, 'memory_mb') ? 'memory_mb' : 'memory']).toBe(4096)
    expect(saved).not.toHaveProperty(Object.hasOwn(resources, 'memory_mb') ? 'memory' : 'memory_mb')
    expect(config.cores).toBe(6)
    await wrapper.setProps({ node: { id: 'another', type: 'vm', data: { config: {
      name: 'Another saved guest', template: '9901', cores: 8, memory: 8192,
    } } } })
    await flushPromises()
    expect(field('CPU Cores').props('modelValue')).toBe(8)
    expect(field('Memory (MB)').props('modelValue')).toBe(8192)
    wrapper.unmount()
  })

  it('focuses VM settings for Escape before slow template loading finishes', async () => {
    let finishLoading
    proxmoxCache.fetchVms.mockImplementationOnce(() => new Promise(resolve => { finishLoading = resolve }))
    const wrapper = mountPanel({ id: 'vm', type: 'vm', data: { config: { name: 'Guest' } } })
    document.body.appendChild(wrapper.element)
    await flushPromises()
    const dialog = wrapper.get('[role="dialog"]')
    expect(document.activeElement).toBe(dialog.element)
    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    finishLoading([])
    await flushPromises()
  })

  it('uses the translated refresh-templates label for keyboard and pointer users', async () => {
    const wrapper = mountPanel({ id: 'vm', type: 'vm', data: { config: { name: 'Guest' } } })
    await flushPromises()
    const button = wrapper.find('[title="Refresh templates from Proxmox"]')
    expect(button.attributes('aria-label')).toBe('Refresh templates from Proxmox')
  })

})


it('shows desired tag edits while preserving observed tags and exposing the write limit', async () => {
  setActivePinia(createPinia())
  const node = { ...makeDeployedVmNode('running'), data: {
    deployed: true, vmId: 42, status: 'running', tags: ['observed'],
    desiredConfig: { tags: ['observed'] }, actualConfig: { tags: ['observed'] },
  } }
  const wrapper = mountPanel(node)
  await flushPromises()
  await wrapper.vm.addPredefinedTag('wanted')
  await flushPromises()
  expect(node.data.desiredConfig.tags).toEqual(['observed', 'wanted'])
  expect(node.data.actualConfig.tags).toEqual(['observed'])
  expect(wrapper.find('[aria-label="Remove tag wanted"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('selected host')
  await wrapper.vm.removeTag('observed')
  await flushPromises()
  expect(node.data.desiredConfig.tags).toEqual(['wanted'])
  expect(node.data.tags).toEqual(['observed'])
  expect(wrapper.find('[aria-label="Remove tag observed"]').exists()).toBe(false)
  wrapper.unmount()
})

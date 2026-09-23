import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useObservedGuestStatus } from '@/composables/useObservedGuestStatus'
const { listRegisteredGuests, getGuestStatus } = vi.hoisted(() => ({ listRegisteredGuests: vi.fn(), getGuestStatus: vi.fn() }))
vi.mock('@/services/proxmox/api', async importOriginal => ({ ...await importOriginal<typeof import('@/services/proxmox/api')>(), listRegisteredGuests, getGuestStatus }))
import { setBaseUrl } from '@/services/proxmox/api'

const makeNode = (id: string, vmId: number, type = 'vm') => ({ id, type, data: { deployed: true, vmId, status: 'stopped', config: { proxmoxNode: 'pve-b', proxmoxHostId: 'host-b' }, desiredConfig: { cores: 4 }, actualConfig: { cores: 2 } } })
const page = (status = 'running') => ({ host: { id: 'host-b', node_name: 'pve-b' }, guests: [{ vmid: 500, type: 'qemu', node: 'pve-b', status }, { vmid: 501, type: 'lxc', node: 'pve-b', status: 'paused' }] })
let scope: ReturnType<typeof effectScope>
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); setActivePinia(createPinia()); setBaseUrl('https://api.test'); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); listRegisteredGuests.mockReset().mockResolvedValue(page()); getGuestStatus.mockReset().mockResolvedValue({ vmid: 500, node: 'pve-b', type: 'qemu', status: 'running' }); scope = effectScope() })
afterEach(() => { scope.stop(); vi.useRealTimers() })
function start(nodes = ref([makeNode('vm', 500), makeNode('lxc', 501, 'lxc')]), projectId = ref('project')) {
  const result = scope.run(() => useObservedGuestStatus({ nodes: () => nodes.value, projectId: () => projectId.value, enabled: () => true,
    target: () => ({ node: 'pve-b' }), apply: (node, patch) => Object.assign(node.data!, patch) }))!
  return { ...result, nodes, projectId }
}
it('groups explicit-host QEMU and LXC reads and updates only their observed state', async () => {
  const view = start(); await flushPromises()
  expect(listRegisteredGuests).toHaveBeenCalledOnce()
  expect(listRegisteredGuests).toHaveBeenCalledWith({ node: 'pve-b', hostId: 'host-b' })
  expect(view.nodes.value.map(node => node.data.status)).toEqual(['running', 'paused'])
  expect(view.nodes.value[0].data.desiredConfig).toEqual({ cores: 4 }); expect(view.nodes.value[0].data.actualConfig).toEqual({ cores: 2 })
  listRegisteredGuests.mockResolvedValue(page('stopped'))
  await vi.advanceTimersByTimeAsync(15000)
  expect(view.nodes.value[0].data.status).toBe('stopped')
})
it('discards late results after project or target identity changes', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void
  listRegisteredGuests.mockImplementation(() => new Promise(done => { resolve = done }))
  const view = start(); await flushPromises()
  view.nodes.value[0].data.vmId = 900; view.projectId.value = 'other'
  resolve(page()); await flushPromises()
  expect(view.nodes.value[0].data.status).not.toBe('running')
})
it('refuses observations after credentials rotate and revalidates the new context', async () => {
  const backend = useBackendApiStore(), id = backend.addHost({ url: 'https://api.test', token: 'old' })
  let resolve!: (value: ReturnType<typeof page>) => void
  listRegisteredGuests.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = start(); await flushPromises(); listRegisteredGuests.mockResolvedValue(page('stopped')); backend.updateHost(id, { token: 'new' })
  resolve(page('running')); await flushPromises()
  expect(view.nodes.value[0].data.status).toBe('stopped')
  expect(listRegisteredGuests).toHaveBeenCalledTimes(2)
})
it('pauses when hidden, invalidates pending reads, resumes visibly and stops on dispose', async () => {
  const view = start(); await flushPromises()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))
  const count = listRegisteredGuests.mock.calls.length; await vi.advanceTimersByTimeAsync(45000)
  expect(listRegisteredGuests).toHaveBeenCalledTimes(count)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'))
  await flushPromises(); expect(listRegisteredGuests).toHaveBeenCalledTimes(count + 1)
  scope.stop(); await vi.advanceTimersByTimeAsync(30000); expect(listRegisteredGuests).toHaveBeenCalledTimes(count + 1)
  expect(view.nodes.value[0].data.status).toBe('running')
})
it('does not overwrite a pending lifecycle action or update nodes that are only drafts', async () => {
  const pending = { ...makeNode('vm', 500), data: { ...makeNode('vm', 500).data, pendingAction: 'stop' } }
  const draft = { ...makeNode('draft', 501), data: { ...makeNode('draft', 501).data, deployed: false } }
  const view = start(ref([pending, draft])); await flushPromises()
  expect(view.nodes.value.map(node => node.data.status)).toEqual(['stopped', 'stopped'])
  expect(listRegisteredGuests).not.toHaveBeenCalled()
})
it('marks unavailable or absent guest state as unknown without claiming stopped', async () => {
  listRegisteredGuests.mockRejectedValue(new Error('Backend denied access'))
  const view = start(); await flushPromises()
  expect(view.nodes.value[0].data.status).toBe('unknown')
  expect(view.error.value).toMatch(/status|read|unavailable/i)
  listRegisteredGuests.mockResolvedValue({ host: { id: 'host-b', node_name: 'pve-b' }, guests: [] })
  await view.refresh(); expect(view.nodes.value[0].data.status).toBe('unknown')
})

it('rejects an in-flight visible read after hiding and keeps its last observation until resumed', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void
  listRegisteredGuests.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = start(); await flushPromises()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
  resolve(page('running')); await flushPromises()
  expect(view.nodes.value[0].data.status).toBe('stopped')
  expect(listRegisteredGuests).toHaveBeenCalledTimes(1)
})
it('does not let an external read clear a lifecycle operation that started during that read', async () => {
  let resolve!: (value: ReturnType<typeof page>) => void
  listRegisteredGuests.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const nodes = ref([{ ...makeNode('vm', 500), data: { ...makeNode('vm', 500).data, pendingAction: undefined as string | undefined } }])
  start(nodes); await flushPromises()
  nodes.value[0].data.pendingAction = 'start'
  resolve(page('running')); await flushPromises()
  expect(nodes.value[0].data.status).toBe('stopped')
  expect(nodes.value[0].data.pendingAction).toBe('start')
})

it('reads QEMU current status when its running process summary hides a paused guest', async () => {
  getGuestStatus.mockResolvedValue({ vmid: 500, node: 'pve-b', type: 'qemu', status: 'paused' })
  const view = start(); await flushPromises()
  expect(getGuestStatus).toHaveBeenCalledWith(500, 'qemu', { node: 'pve-b', hostId: 'host-b' })
  expect(view.nodes.value[0].data.status).toBe('paused')
  expect(view.nodes.value[1].data.status).toBe('paused')
  expect(getGuestStatus).toHaveBeenCalledOnce()
})

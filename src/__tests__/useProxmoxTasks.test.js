import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { getTaskStatus, getGuestStatus, context } = vi.hoisted(() => ({ getTaskStatus: vi.fn(), getGuestStatus: vi.fn(), context: { current: true } }))
vi.mock('@/services/proxmox/api', () => ({ getTaskStatus, getGuestStatus, captureBackendGuard: () => () => { if (!context.current) throw new Error('Backend context changed') } }))
vi.mock('@/services/proxmox/cache', () => ({ proxmoxCache: { invalidate: vi.fn() } }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { useProxmoxTasks } from '@/composables/useProxmoxTasks'
import { useActivityLogStore } from '@/stores/activityLogStore'

function makeNode(status = 'stopped') {
  return { id: 'n1', type: 'vm', data: { status, vmId: 4001, deployed: true, config: { proxmoxNode: 'pve01', proxmoxHostId: 'registered' } } }
}

// Synchronous fake timer: fires the callback immediately.
const immediateTimeout = (cb) => { cb(); return 0 }

describe('useProxmoxTasks.launch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getTaskStatus.mockReset()
    getGuestStatus.mockReset().mockResolvedValue({ vmid: 4001, type: 'qemu', node: 'pve01', status: 'stopped' })
    context.current = true
  })

  it('pending → transitional status → poll OK → confirmed status', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })

    const onSuccess = vi.fn()
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess,
    })

    expect(onSuccess).toHaveBeenCalledOnce()
    expect(node.data.pendingAction).toBeFalsy()
    expect(node.data.status).toBe('stopped') // written by the composable, not onSuccess
    expect(log.entries.some((e) => e.level === 'success')).toBe(true)
  })

  it('ignores a second launch while an action is already in flight', async () => {
    const node = makeNode('running')
    node.data.pendingAction = 'stop' // simulate in-flight
    const apiCall = vi.fn(async () => ({ upid: 'U' }))
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('start', { node, vmId: 4001, vmtype: 'qemu', apiCall, onSuccess: vi.fn() })
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('delete OK calls onSuccess (node removal) and logs success', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
    const node = makeNode('stopped')
    const removed = vi.fn()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('delete', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: removed,
    })
    expect(removed).toHaveBeenCalledOnce()
  })

  it('poll error reverts node + logs error', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'command failed', node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: vi.fn(),
    })
    expect(node.data.status).toBe('running') // reverted
    expect(node.data.pendingAction).toBeFalsy()
    expect(log.entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('apiCall throwing (e.g. no host) logs error, no poll', async () => {
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => { throw new Error('No Proxmox host registered.') },
      onSuccess: vi.fn(),
    })
    expect(getTaskStatus).not.toHaveBeenCalled()
    expect(node.data.pendingAction).toBeFalsy()
    expect(log.entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('timeout (always running) reverts + logs error', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'running', exitstatus: null, node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout, maxPolls: 3 })
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: vi.fn(),
    })
    expect(node.data.status).toBe('running')
    expect(log.entries.some((e) => e.level === 'error' && /tim/i.test(e.message))).toBe(true)
  })
})


describe('task backend context', () => {
  it('never confirms a task after the backend changes during a successful poll', async () => {
    setActivePinia(createPinia())
    context.current = true
    getTaskStatus.mockImplementation(async () => {
      context.current = false
      return { status: 'stopped', exitstatus: 'OK' }
    })
    const node = { id: 'n', data: { status: 'stopped' } }
    const onSuccess = vi.fn()
    const tasks = useProxmoxTasks({ setTimeoutFn: fn => fn(), maxPolls: 1 })
    await tasks.launch('start', { node, vmId: 42, vmtype: 'qemu', apiCall: async () => ({ upid: 'UPID:pve-b:1:task::' }), onSuccess })
    expect(onSuccess).not.toHaveBeenCalled()
    expect(node.data.status).toBe('stopped')
    expect(node.data.pendingAction).toBeUndefined()
  })
})


it('keeps a successful HTTP response without a task ID unconfirmed', async () => {
  setActivePinia(createPinia())
  context.current = true
  const node = makeNode('stopped')
  const onSuccess = vi.fn()
  const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })
  await tasks.launch('start', { node, vmId: 42, vmtype: 'qemu', apiCall: async () => ({}), onSuccess })
  expect(onSuccess).not.toHaveBeenCalled()
  expect(node.data.status).toBe('stopped')
  expect(node.data.pendingAction).toBeUndefined()
})

describe('observed guest state after successful tasks', () => {
  beforeEach(() => { setActivePinia(createPinia()); context.current = true; getTaskStatus.mockResolvedValue({ status: 'stopped', exitstatus: 'OK' }); getGuestStatus.mockReset() })
  it('uses the fresh observed status rather than assuming start means running', async () => {
    const node = makeNode('paused'), done = vi.fn()
    getGuestStatus.mockResolvedValue({ vmid: 4001, type: 'qemu', node: 'pve01', status: 'stopped' })
    await useProxmoxTasks({ setTimeoutFn: immediateTimeout }).launch('start', { node, vmId: 4001, vmtype: 'qemu', apiCall: async () => ({ upid: 'UPID:pve01:1' }), onSuccess: done })
    expect(node.data.status).toBe('stopped')
    expect(getGuestStatus).toHaveBeenCalledWith(4001, 'qemu', { node: 'pve01', hostId: 'registered' })
    expect(done).toHaveBeenCalledOnce()
  })
  it('reads the selected LXC through the explicit guest-type endpoint', async () => {
    const node = { ...makeNode('running'), type: 'lxc' }, done = vi.fn()
    getGuestStatus.mockResolvedValue({ vmid: 4001, type: 'lxc', node: 'pve01', status: 'stopped' })
    await useProxmoxTasks({ setTimeoutFn: immediateTimeout }).launch('stop', { node, vmId: 4001, vmtype: 'lxc', apiCall: async () => ({ upid: 'UPID:pve01:1' }), onSuccess: done })
    expect(node.data.status).toBe('stopped'); expect(done).toHaveBeenCalledOnce()
    expect(getGuestStatus).toHaveBeenCalledWith(4001, 'lxc', { node: 'pve01', hostId: 'registered' })
    expect(getTaskStatus).toHaveBeenLastCalledWith('UPID:pve01:1', { node: 'pve01', hostId: 'registered' })
  })
  it('leaves status explicitly unknown when the task succeeded but readback fails', async () => {
    const node = makeNode('stopped'), done = vi.fn()
    getGuestStatus.mockRejectedValue(new Error('Readback unavailable'))
    await useProxmoxTasks({ setTimeoutFn: immediateTimeout }).launch('start', { node, vmId: 4001, vmtype: 'qemu', apiCall: async () => ({ upid: 'UPID:pve01:1' }), onSuccess: done })
    expect(node.data.status).toBe('unknown')
    expect(node.data.statusError).toMatch(/read|observ|confirm/i)
    expect(done).not.toHaveBeenCalled()
  })
  it('does not apply a late observation to a changed VM identity', async () => {
    const node = makeNode('stopped'), done = vi.fn()
    getGuestStatus.mockImplementation(async () => { node.data.vmId = 5002; node.data.status = 'paused'; return { vmid: 4001, type: 'qemu', node: 'pve01', status: 'running' } })
    await useProxmoxTasks({ setTimeoutFn: immediateTimeout }).launch('start', { node, vmId: 4001, vmtype: 'qemu', apiCall: async () => ({ upid: 'UPID:pve01:1' }), onSuccess: done })
    expect(node.data.status).toBe('paused'); expect(done).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { getTaskStatus } = vi.hoisted(() => ({ getTaskStatus: vi.fn() }))
vi.mock('@/services/proxmox/api', () => ({ getTaskStatus }))
vi.mock('@/services/proxmox/cache', () => ({ proxmoxCache: { invalidate: vi.fn() } }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { useProxmoxTasks } from '@/composables/useProxmoxTasks'
import { useActivityLogStore } from '@/stores/activityLogStore'

function makeNode(status = 'stopped') {
  return { id: 'n1', type: 'vm', data: { status, vmId: 4001, deployed: true } }
}

// Synchronous fake timer: fires the callback immediately.
const immediateTimeout = (cb) => { cb(); return 0 }

describe('useProxmoxTasks.launch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getTaskStatus.mockReset()
  })

  it('pending → transitional status → poll OK → confirmed status', async () => {
    getTaskStatus.mockResolvedValue({ upid: 'U', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
    const node = makeNode('running')
    const log = useActivityLogStore()
    const tasks = useProxmoxTasks({ setTimeoutFn: immediateTimeout })

    let confirmed = null
    await tasks.launch('stop', {
      node, vmId: 4001, vmtype: 'qemu',
      apiCall: async () => ({ upid: 'U' }),
      onSuccess: () => { confirmed = 'stopped'; node.data.status = 'stopped' },
    })

    expect(confirmed).toBe('stopped')
    expect(node.data.pendingAction).toBeFalsy()
    expect(node.data.status).toBe('stopped')
    expect(log.entries.some((e) => e.level === 'success')).toBe(true)
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

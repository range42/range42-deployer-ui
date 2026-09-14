import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getRegisteredHost, getTaskStatus, lxc, setBaseUrl, snapshot, storage, vm } from '@/services/proxmox/api'
import { useBackendApiStore } from '@/stores/backendApiStore'

const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const first = { id: 'host-a', node_name: 'pve-a' }
const intended = { id: 'host-b', node_name: 'pve-b' }
const registry = items => ({ items, total: items.length, offset: 0, limit: 100 })

function backend(items = [first, intended]) {
  vi.stubGlobal('fetch', vi.fn(async url => url.endsWith('/hosts')
    ? response(registry(items))
    : response({ items: [], config: { name: 'guest', cores: 2, memory: 1024 }, status: 'accepted', upid: 'UPID:pve-b:1' })))
}

beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); setBaseUrl('https://backend.test') })
afterEach(() => vi.unstubAllGlobals())

describe('registered Proxmox target resolution', () => {
  it('honors the intended node across lifecycle, config, storage and snapshots', async () => {
    backend()
    await vm.start({ proxmox_node: 'pve-b', vm_id: 42 })
    await vm.getConfig(42, 'qemu', { node: 'pve-b' })
    await lxc.stop('pve-b', 43)
    await storage.list('pve-b')
    await snapshot.create({ proxmox_node: 'pve-b', vm_id: 42, vm_snapshot_name: 'before' })
    const targets = fetch.mock.calls.filter(([url]) => !url.endsWith('/hosts'))
    expect(targets).toHaveLength(5)
    expect(targets.every(([url]) => url.includes('/hosts/host-b/'))).toBe(true)
  })

  it('uses an explicit registered host only when its node also matches', async () => {
    backend([{ id: 'same-name-other-cluster', node_name: 'pve-b' }, intended])
    expect(await getRegisteredHost({ node: 'pve-b', hostId: 'host-b' })).toEqual(intended)
    await expect(getRegisteredHost({ node: 'pve-a', hostId: 'host-b' })).rejects.toThrow(/matching|match|target/i)
  })

  it.each([
    ['missing node', [first], 'pve-b'],
    ['duplicate node names', [intended, { id: 'other-cluster', node_name: 'pve-b' }], 'pve-b'],
    ['no intended target', [first, intended], undefined],
  ])('refuses %s before mutation', async (_, hosts, node) => {
    backend(hosts)
    await expect(vm.start({ proxmox_node: node, vm_id: 42 })).rejects.toThrow()
    expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
  })

  it('refuses an incomplete registry rather than assuming the unseen nodes differ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...registry([intended]), total: 2 })))
    await expect(vm.start({ proxmox_node: 'pve-b', vm_id: 42 })).rejects.toThrow(/incomplete|complete|registry/i)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rechecks registrations instead of retaining a deleted or changed host', async () => {
    backend([intended])
    await vm.list('pve-b')
    backend([first])
    await expect(vm.start({ proxmox_node: 'pve-b', vm_id: 42 })).rejects.toThrow()
    expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
  })

  it.each(['backend', 'token'])('refuses a %s change during host lookup without a write', async change => {
    const store = useBackendApiStore()
    const id = store.addHost({ url: 'https://backend.test', token: 'before', nodeName: 'pve-b' })
    let finish
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
    const result = vm.start({ proxmox_node: 'pve-b', vm_id: 42 }).catch(error => error)
    if (change === 'backend') setBaseUrl('https://other.test')
    else store.updateHost(id, { token: 'after' })
    finish(response(registry([intended])))
    expect(await result).toMatchObject({ message: expect.stringMatching(/changed|context/i) })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses the matching saved backend node when no operation target was supplied', async () => {
    useBackendApiStore().addHost({ url: 'https://backend.test', token: 'selected', nodeName: 'pve-b' })
    backend()
    await vm.delete(42)
    expect(fetch.mock.calls.at(-1)[0]).toContain('/hosts/host-b/vms/42?')
    expect(fetch.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer selected')
  })
})


describe('legacy config mutation boundary', () => {
  it.each([
    ['setTags', ['pve-b', 42, ['wanted']]],
    ['setName', ['pve-b', 42, 'wanted']],
    ['setDescription', ['pve-b', 42, 'wanted']],
    ['setCpu', ['pve-b', 42, 4]],
    ['setMemory', ['pve-b', 42, 2048]],
  ])('refuses %s before a global-inventory write', async (method, args) => {
    backend()
    await expect(vm[method](...args)).rejects.toThrow(/selected host|host.bound/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})


describe('task node resolution', () => {
  it('polls the UPID node even when the saved backend defaults to another node', async () => {
    useBackendApiStore().addHost({ url: 'https://backend.test', nodeName: 'pve-a' })
    backend()
    await getTaskStatus('UPID:pve-b:0001:task::')
    expect(fetch.mock.calls.at(-1)[0]).toContain('/hosts/host-b/tasks/')
  })
  it.each(['not-a-task', 'UPID::x'])('refuses malformed UPID %s without lookup', async upid => {
    backend()
    await expect(getTaskStatus(upid)).rejects.toThrow(/task|UPID/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})


it.each(['', null, 0])('refuses an explicitly invalid target node %s rather than falling back', async node => {
  backend([intended])
  await expect(vm.start({ proxmox_node: node, vm_id: 42 })).rejects.toThrow(/target|node/i)
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInfrastructureImport } from '@/composables/useInfrastructureImport'
import { setBaseUrl } from '@/services/proxmox/api'
import { proxmoxCache } from '@/services/proxmox/cache'
import { serializeToCatalogEntry, extractLayout, deserializeToCanvas } from '@/overlay/serialize'

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const guests = [
  { vmid: 500, name: 'guest', node: 'pve-b', type: 'qemu', status: 'running', maxcpu: 2, maxmem: 1024 ** 3, tags: 'observed' },
  { vmid: 501, name: 'container', node: 'pve-b', type: 'lxc', status: 'stopped' },
]
const configs: Record<string, Record<string, unknown>> = {
  '500': { name: 'guest', description: 'observed description', cores: 2, memory: 1024, net0: 'virtio=AA,bridge=vmbr1', ipconfig0: 'ip=10.1.0.2/24', net1: 'virtio=BB,bridge=vmbr1', ipconfig1: 'ip=10.1.0.3/24', net10: 'virtio=CC,bridge=vmbr2', ipconfig10: 'ip=10.2.0.2/24' },
  '501': { hostname: 'container', cores: 1, memory: 512, net0: 'name=eth0,bridge=vmbr1,ip=10.1.0.4/24', net1: 'name=eth1,bridge=vmbr1,ip=10.1.0.5/24' },
}
function install(denied = false) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input)
    if (url.pathname === '/v1/proxmox/hosts') return response({ items: [{ id: 'selected', node_name: 'pve-b' }], offset: 0, total: 1 })
    if (url.pathname.endsWith('/vms')) return response({ items: guests, offset: 0, total: guests.length })
    if (url.pathname.endsWith('/config')) {
      if (denied) return response({ message: 'Config access denied' }, 403)
      const vmid = url.pathname.split('/').at(-2)!
      return response({ config: configs[vmid], vmid: Number(vmid), node: 'pve-b', type: vmid === '501' ? 'lxc' : 'qemu' })
    }
    throw new Error('Unexpected request')
  }))
}
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); setBaseUrl('https://api.test'); proxmoxCache.vmCache.value = []; proxmoxCache.invalidate(); install() })
afterEach(() => vi.unstubAllGlobals())

describe('imported NIC identities and canonical persistence', () => {
  it('preserves every QEMU/LXC NIC including repeated bridges and indexes above9 across canonical save/reopen', async () => {
    const importer = useInfrastructureImport(); importer.setNode('pve-b'); await importer.fetchResources(); importer.selectAll()
    const result = await importer.importSelected()
    expect(result.success).toBe(true)
    expect(result.edges).toHaveLength(5)
    expect(new Set(result.edges.map(edge => edge.id)).size).toBe(5)
    const canvas = { ...result, attachments: [] }
    const doc = serializeToCatalogEntry(canvas, { name: 'Imported' })
    expect(doc.nodes.find(node => node.id === 'imported-vm-500')?.networks).toEqual([
      { node_ref: 'imported-network-vmbr1', ip: '10.1.0.2' }, { node_ref: 'imported-network-vmbr1', ip: '10.1.0.3' }, { node_ref: 'imported-network-vmbr2', ip: '10.2.0.2' },
    ])
    const restored = deserializeToCanvas(doc, extractLayout(canvas))
    expect(restored.edges.map(edge => [edge.id, edge.source, edge.target, edge.data?.connection?.ipAddress])).toEqual(result.edges.map(edge => [edge.id, edge.source, edge.target, edge.data?.connection?.ipAddress]))
    expect(result.nodes.filter(node => ['vm', 'lxc'].includes(node.type)).every(node => (node.data.config as Record<string, unknown>).proxmoxHostId === 'selected')).toBe(true)
  })
  it('does not call a NIC-less summary a successful import when raw config is refused', async () => {
    install(true)
    const importer = useInfrastructureImport(); importer.setNode('pve-b'); await importer.fetchResources(); importer.selectAll()
    const result = await importer.importSelected()
    expect(result.success).toBe(false)
    expect(result.nodes).toEqual([]); expect(result.edges).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

it('discards a late import after the selected node changes without returning partial nodes', async () => {
  const importer = useInfrastructureImport(); importer.setNode('pve-b'); await importer.fetchResources(); importer.selectAll()
  let finish!: (response: Response) => void
  const oldFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn((input: string, options?: RequestInit) => String(input).includes('/vms/500/config?')
    ? new Promise<Response>(resolve => { finish = resolve }) : oldFetch(input, options)))
  const pending = importer.importSelected()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  importer.setNode('another-node')
  finish(response({ config: configs['500'] }))
  const result = await pending
  expect(result.success).toBe(false); expect(result.nodes).toEqual([]); expect(result.edges).toEqual([])
})

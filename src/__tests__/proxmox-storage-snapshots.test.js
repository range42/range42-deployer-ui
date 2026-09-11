import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { storage, snapshot, setBaseUrl } from '@/services/proxmox/api'
import { useBackendApiStore } from '@/stores/backendApiStore'

const response = body => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json' },
})
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  setBaseUrl('https://api.test')
  globalThis.fetch = vi.fn(async url => url.endsWith('/hosts')
    ? response({ items: [{ id: 'host-1', node_name: 'pve' }] })
    : response({ items: [{ name: 'item' }], status: 'accepted', upid: 'UPID:1' }))
})

const lastRequest = () => {
  const [url, options] = fetch.mock.calls.at(-1)
  return { url, ...options, body: options.body ? JSON.parse(options.body) : undefined }
}

describe('v1 storage and snapshots', () => {
  it('lists pools and storage content from Page envelopes', async () => {
    expect(await storage.list('ignored')).toEqual([{ name: 'item' }])
    expect(lastRequest()).toMatchObject({ method: 'GET', url: 'https://api.test/v1/proxmox/hosts/host-1/storage' })
    expect(await storage.listIsos('ignored', 'local')).toEqual([{ name: 'item' }])
    expect(lastRequest().url).toContain('/storage/local/content?content=iso')
    expect(await storage.listTemplates('ignored', 'local')).toEqual([{ name: 'item' }])
    expect(lastRequest().url).toContain('/storage/local/content?content=vztmpl')
  })

  it('downloads an ISO with the v1 content discriminator and optional checksum', async () => {
    expect(await storage.downloadIso({ storage: 'local', url: 'https://example.test/a.iso', filename: 'a.iso', checksum: 'abc', checksum_algorithm: 'sha256' })).toMatchObject({ upid: 'UPID:1' })
    expect(lastRequest()).toMatchObject({ method: 'POST', url: 'https://api.test/v1/proxmox/hosts/host-1/storage/local/download-url', body: { content: 'iso', url: 'https://example.test/a.iso', filename: 'a.iso', checksum: 'abc', checksum_algorithm: 'sha256' } })
  })

  it('creates and lists LXC snapshots without accidentally targeting qemu', async () => {
    await snapshot.create({ vm_id: 501, vm_snapshot_name: 'ready', vm_snapshot_description: 'Before changes', vmtype: 'lxc' })
    expect(lastRequest()).toMatchObject({ method: 'POST', url: 'https://api.test/v1/proxmox/hosts/host-1/vms/501/snapshots?vmtype=lxc', body: { snapname: 'ready', description: 'Before changes' } })
    expect(await snapshot.list('ignored', 501, 'lxc')).toEqual([{ name: 'item' }])
    expect(lastRequest()).toMatchObject({ method: 'GET', url: 'https://api.test/v1/proxmox/hosts/host-1/vms/501/snapshots?vmtype=lxc' })
  })

  it('rolls back and deletes snapshots using encoded names and returns the task', async () => {
    const request = { vm_id: 501, vm_snapshot_name: 'ready state', vmtype: 'qemu' }
    expect(await snapshot.revert(request)).toMatchObject({ upid: 'UPID:1' })
    expect(lastRequest()).toMatchObject({ method: 'POST', url: 'https://api.test/v1/proxmox/hosts/host-1/vms/501/snapshots/ready%20state/rollback?vmtype=qemu' })
    await snapshot.delete(request)
    expect(lastRequest()).toMatchObject({ method: 'DELETE', url: 'https://api.test/v1/proxmox/hosts/host-1/vms/501/snapshots/ready%20state?vmtype=qemu' })
  })

  it('sends credentials only to the backend matching the configured client URL', async () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://api.test', token: 'matching-token' })
    backend.addHost({ url: 'https://other.test', token: 'other-token' })
    await storage.list('ignored')
    expect(lastRequest().headers.Authorization).toBe('Bearer matching-token')
    setBaseUrl('https://untrusted.test')
    await storage.list('ignored')
    expect(lastRequest().headers.Authorization).toBeUndefined()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getTaskStatus, setBaseUrl, vm } from '@/services/proxmox/api'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { reactive } from 'vue'
import type { VmConfigReview } from '@/services/proxmox/configReview'

const fields = { name: 'guest', cores: 2, memory: 1024, tags: '', description: '' }
const review = () => ({ host_id: 'selected', node: 'pve-b', vmid: 42, vmtype: 'qemu' as const,
  digest: 'a'.repeat(64), target_digest: 'c'.repeat(64), current: { ...fields }, configured: { ...fields }, pending: [] })
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
function backend(result: unknown = review()) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/hosts')
    ? { offset: 0, total: 2, items: [{ id: 'wrong', node_name: 'pve-a' }, { id: 'selected', node_name: 'pve-b' }] }
    : result)))
}
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); setBaseUrl('https://backend.test') })
afterEach(() => vi.unstubAllGlobals())

describe('reviewed registered-host configuration', () => {
  it('reads an exact guest review through its selected registered host', async () => {
    backend()
    expect(vm.getConfigReview).toBeTypeOf('function')
    expect(await vm.getConfigReview(42, 'qemu', { node: 'pve-b' })).toEqual(review())
    expect(fetch).toHaveBeenLastCalledWith('https://backend.test/v1/proxmox/hosts/selected/vms/42/config/review?vmtype=qemu', expect.objectContaining({ method: 'GET' }))
  })

  it('sends one whitelisted patch and digest to the reviewed host, retaining pending observations', async () => {
    const after = { ...review(), digest: 'b'.repeat(64), configured: { ...fields, memory: 2048 }, pending: ['memory'] }
    backend({ status: 'configured', upid: null, review: after })
    expect(vm.updateConfig).toBeTypeOf('function')
    const result = await vm.updateConfig(review(), { memory: 2048 })
    expect(result.review?.current.memory).toBe(1024)
    expect(result.review?.pending).toEqual(['memory'])
    expect(fetch).toHaveBeenLastCalledWith('https://backend.test/v1/proxmox/hosts/selected/vms/42/config?vmtype=qemu', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ digest: 'a'.repeat(64), changes: { memory: 2048 } }) }))
  })

  it.each(['host_id', 'node', 'vmid', 'vmtype', 'digest', 'pending'])('refuses a mismatched or malformed review %s', async field => {
    backend({ ...review(), [field]: field === 'vmid' ? 43 : 'unexpected' })
    expect(vm.getConfigReview).toBeTypeOf('function')
    await expect(vm.getConfigReview(42, 'qemu', { node: 'pve-b' })).rejects.toThrow(/configuration|review|target/i)
  })

  it.each([{ disk: 30 }, { name: '../guest' }, { memory: '2048' }, { tags: ['admin'] }, {}, { cores: 0 }])('refuses invalid patches before a request: %j', async changes => {
    backend()
    expect(vm.updateConfig).toBeTypeOf('function')
    await expect(vm.updateConfig(review(), changes)).rejects.toThrow(/configuration|change|field|memory|name|tags|cores/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not dispatch after the dialog context changes during target lookup', async () => {
    let release!: (result: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { release = resolve })))
    let current = true
    expect(vm.updateConfig).toBeTypeOf('function')
    const pending = vm.updateConfig(review(), { name: 'wanted' }, () => { if (!current) throw new Error('Review changed') })
    current = false
    release(response({ offset: 0, total: 1, items: [{ id: 'selected', node_name: 'pve-b' }] }))
    await expect(pending).rejects.toThrow(/changed/)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('retains the backend credential guard through write completion', async () => {
    const store = useBackendApiStore()
    const id = store.addHost({ url: 'https://backend.test', token: 'before', nodeName: 'pve-b' })
    let release!: (result: Response) => void
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/hosts')
      ? response({ offset: 0, total: 1, items: [{ id: 'selected', node_name: 'pve-b' }] })
      : new Promise<Response>(resolve => { release = resolve })))
    expect(vm.updateConfig).toBeTypeOf('function')
    const pending = vm.updateConfig(review(), { name: 'wanted' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    store.updateHost(id, { token: 'after' })
    release(response({ status: 'configured', upid: null, review: review() }))
    await expect(pending).rejects.toThrow(/context|changed/i)
  })

  it('accepts the reactive review held by the Vue dialog', async () => {
    backend({ status: 'configured', upid: null, review: review() })
    expect(await vm.updateConfig(reactive(review()), { name: 'wanted' })).toMatchObject({ status: 'configured' })
  })

  it.each([{ vmid: '../42' }, { vmid: 0 }, { node: '../pve-b' }, { host_id: '' }, { vmtype: 'other' }])('rejects invalid review identity before requests: %j', async replacement => {
    backend()
    await expect(vm.updateConfig({ ...review(), ...replacement } as VmConfigReview, { name: 'wanted' })).rejects.toThrow(/configuration|target|review/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'configured', upid: null, review: null },
    { status: 'accepted', upid: null, review: null },
    { status: 'accepted', upid: 'UPID:pve-a:1', review: null },
    { status: 'configured', upid: null, review: { ...review(), vmid: 43 } },
  ])('does not confirm malformed write outcomes', async outcome => {
    backend(outcome)
    expect(vm.updateConfig).toBeTypeOf('function')
    await expect(vm.updateConfig(review(), { name: 'wanted' })).rejects.toThrow(/configuration|review|target|unconfirmed/i)
  })

  it('guards task polling with the reviewed server fingerprint', async () => {
    backend({ status: 'stopped', exitstatus: 'OK' })
    await getTaskStatus('UPID:pve-b:A:B:C:qmconfig:42:root@pam:', { node: 'pve-b', hostId: 'selected' }, 'c'.repeat(64))
    expect(fetch.mock.calls.at(-1)?.[0]).toContain(`?expected_target_digest=${'c'.repeat(64)}`)
  })

  it('refuses a configured response from a rebound registration', async () => {
    backend({ status: 'configured', upid: null, review: { ...review(), target_digest: 'd'.repeat(64) } })
    await expect(vm.updateConfig(review(), { name: 'wanted' })).rejects.toThrow(/target|configuration|review/i)
  })
})

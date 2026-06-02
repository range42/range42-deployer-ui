import { describe, it, expect, beforeEach, vi } from 'vitest'
import { vm, lxc, setBaseUrl, _resetHostCacheForTests } from '@/services/proxmox/api'

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const HOSTS = { items: [{ id: 'H1', name: 'pve01-range42', node_name: 'pve01' }] }
const VMS = {
  items: [
    { vmid: 4001, name: 'vb1', type: 'qemu', status: 'running', node: 'pve01', maxmem: 4, maxcpu: 1, template: false, tags: 'admin' },
    { vmid: 200, name: 'ct', type: 'lxc', status: 'stopped', node: 'pve01' },
    { vmid: 9000, name: 'tmpl', type: 'qemu', status: 'stopped', node: 'pve01', template: true },
  ],
}

function install(handler) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, opts) => {
    calls.push([opts?.method || 'GET', url])
    return handler(url, opts)
  })
  return calls
}

function defaultHandler(url) {
  if (url.endsWith('/v1/proxmox/hosts')) return jsonResp(HOSTS)
  if (url.includes('/vms') && !url.includes('/status/')) return jsonResp(VMS)
  return jsonResp({ status: 'accepted', upid: 'UPID:x' })
}

describe('proxmox api — v1 migration', () => {
  beforeEach(() => {
    setBaseUrl('http://api')
    _resetHostCacheForTests()
  })

  it('vm.list resolves the registered host then returns qemu only (normalized)', async () => {
    const calls = install(defaultHandler)
    const out = await vm.list('ignored-node')
    expect(out.map((v) => v.vmid).sort((a, b) => a - b)).toEqual([4001, 9000])
    const vb = out.find((v) => v.vmid === 4001)
    expect(vb.status).toBe('running')
    expect(vb.tags).toBe('admin')
    expect(out.find((v) => v.vmid === 9000).isTemplate).toBe(true)
    expect(calls.some(([, u]) => u.endsWith('/v1/proxmox/hosts'))).toBe(true)
    expect(calls.some(([, u]) => u.endsWith('/v1/proxmox/hosts/H1/vms'))).toBe(true)
  })

  it('lxc.list returns lxc only from the same endpoint', async () => {
    install(defaultHandler)
    const out = await lxc.list('ignored')
    expect(out.map((v) => v.vmid)).toEqual([200])
  })

  it('vm.start posts to v1 status endpoint with vmtype=qemu', async () => {
    const calls = install(defaultHandler)
    await vm.start({ proxmox_node: 'x', vm_id: 4001 })
    expect(
      calls.some(([m, u]) => m === 'POST' && u.endsWith('/v1/proxmox/hosts/H1/vms/4001/status/start?vmtype=qemu')),
    ).toBe(true)
  })

  it('maps stop->shutdown (graceful), stopForce->stop, pause->suspend, resume->resume', async () => {
    const cases = [
      [() => vm.stop({ vm_id: 1 }), '/vms/1/status/shutdown?vmtype=qemu'],
      [() => vm.stopForce({ vm_id: 1 }), '/vms/1/status/stop?vmtype=qemu'],
      [() => vm.pause({ vm_id: 1 }), '/vms/1/status/suspend?vmtype=qemu'],
      [() => vm.resume({ vm_id: 1 }), '/vms/1/status/resume?vmtype=qemu'],
    ]
    for (const [fn, suffix] of cases) {
      _resetHostCacheForTests()
      const calls = install(defaultHandler)
      await fn()
      expect(calls.some(([m, u]) => m === 'POST' && u.endsWith(suffix))).toBe(true)
    }
  })

  it('lxc.start/stop target the lxc vmtype', async () => {
    const calls = install(defaultHandler)
    await lxc.start('n', 200)
    await lxc.stop('n', 200)
    expect(calls.some(([, u]) => u.endsWith('/vms/200/status/start?vmtype=lxc'))).toBe(true)
    expect(calls.some(([, u]) => u.endsWith('/vms/200/status/shutdown?vmtype=lxc'))).toBe(true)
  })

  it('throws a clear error when no host is registered', async () => {
    install((url) => (url.endsWith('/v1/proxmox/hosts') ? jsonResp({ items: [] }) : jsonResp({})))
    await expect(vm.list('x')).rejects.toThrow(/no proxmox host/i)
  })
})

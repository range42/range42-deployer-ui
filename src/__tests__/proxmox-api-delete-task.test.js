import { describe, it, expect, beforeEach, vi } from 'vitest'
import { vm, lxc, getTaskStatus, setBaseUrl, _resetHostCacheForTests } from '@/services/proxmox/api'

const HOSTS = [{ id: 'H1', name: 'pve01-range42', node_name: 'pve01' }]

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
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
  if (url.endsWith('/v1/proxmox/hosts')) return jsonResp({ items: HOSTS })
  if (url.includes('/tasks/')) {
    return jsonResp({ upid: 'UPID:x', status: 'stopped', exitstatus: 'OK', node: 'pve01' })
  }
  return jsonResp({ status: 'accepted', upid: 'UPID:x' })
}

describe('proxmox v1 delete + task status', () => {
  beforeEach(() => {
    setBaseUrl('http://api')
    _resetHostCacheForTests()
  })

  it('vm.delete issues a v1 DELETE with vmtype + purge query', async () => {
    const calls = install(defaultHandler)
    const res = await vm.delete(4001, { vmtype: 'qemu', purge: true })
    expect(res.upid).toBe('UPID:x')
    expect(calls.some(([m, u]) =>
      m === 'DELETE' && u.endsWith('/v1/proxmox/hosts/H1/vms/4001?vmtype=qemu&purge=true'),
    )).toBe(true)
  })

  it('lxc.delete issues a v1 DELETE with vmtype=lxc', async () => {
    const calls = install(defaultHandler)
    await lxc.delete(200, { vmtype: 'lxc' })
    expect(calls.some(([m, u]) =>
      m === 'DELETE' && u.endsWith('/v1/proxmox/hosts/H1/vms/200?vmtype=lxc&purge=true'),
    )).toBe(true)
  })

  it('getTaskStatus GETs the encoded UPID task-status endpoint', async () => {
    const calls = install(defaultHandler)
    const res = await getTaskStatus('UPID:pve01:0001:delete::')
    expect(res.status).toBe('stopped')
    expect(res.exitstatus).toBe('OK')
    expect(calls.some(([m, u]) =>
      m === 'GET' &&
      u.endsWith('/v1/proxmox/hosts/H1/tasks/UPID%3Apve01%3A0001%3Adelete%3A%3A/status'),
    )).toBe(true)
  })
})

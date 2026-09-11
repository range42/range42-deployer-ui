import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { backendRequest } from '@/services/backendApi'

afterEach(() => vi.unstubAllGlobals())
it('preserves public field validation reasons without copying arbitrary error payload data', async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ code: 'VALIDATION', message: 'Request validation failed',
    details: [{ field: 'body.networks.0.subnet', reason: 'Subnet must use its network address', input: 'excluded' }, { field: 4, reason: 'invalid shape' }] }) }))
  const error = await backendRequest('/v1/proxmox/hosts/pve/reservations').catch(cause => cause)
  expect(error.details).toEqual([{ field: 'body.networks.0.subnet', reason: 'Subnet must use its network address' }])
  expect(error.code).toBe('VALIDATION')
})

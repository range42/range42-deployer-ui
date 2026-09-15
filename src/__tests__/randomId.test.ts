import { describe, expect, it, vi } from 'vitest'
import { randomId } from '@/services/randomId'

describe('browser identifiers', () => {
  it('uses cryptographic randomness on HTTP where randomUUID is unavailable', () => {
    const native = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('HTTPS only') })
    const values = new Set(Array.from({ length: 100 }, () => randomId()))
    expect(values.size).toBe(100)
    for (const value of values) expect(value).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(native).not.toHaveBeenCalled()
    native.mockRestore()
  })
})

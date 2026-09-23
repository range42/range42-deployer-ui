import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import {
  useUserStore,
  validateDisplayName,
  validateColor,
  USER_STORAGE_KEY,
} from '../stores/userStore.ts'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => vi.restoreAllMocks())

describe('validateDisplayName', () => {
  it('requires non-empty', () => {
    expect(validateDisplayName('')).toMatch(/required/i)
    expect(validateDisplayName('   ')).toMatch(/required/i)
  })
  it('accepts valid names', () => {
    expect(validateDisplayName('Alice')).toBe(null)
    expect(validateDisplayName('Dr. Strange 42')).toBe(null)
  })
  it('rejects over-64 characters', () => {
    expect(validateDisplayName('x'.repeat(65))).toMatch(/64/)
    expect(validateDisplayName('x'.repeat(64))).toBe(null)
  })
})

describe('validateColor', () => {
  it('accepts hex in 3/6/8 form', () => {
    expect(validateColor('#abc')).toBe(null)
    expect(validateColor('#3b82f6')).toBe(null)
    expect(validateColor('#3b82f6cc')).toBe(null)
  })
  it('rejects malformed hex', () => {
    expect(validateColor('')).toMatch(/required/i)
    expect(validateColor('3b82f6')).toMatch(/hex/i)
    expect(validateColor('#zz')).toMatch(/hex/i)
  })
})

describe('useUserStore', () => {
  it('starts empty with default color', () => {
    const store = useUserStore()
    expect(store.settings.display_name).toBe('')
    expect(store.settings.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(store.isConfigured).toBe(false)
  })

  it('rejects empty display_name', () => {
    const store = useUserStore()
    const err = store.setDisplayName('')
    expect(err).toMatch(/required/i)
    expect(store.settings.display_name).toBe('')
    expect(store.isConfigured).toBe(false)
  })

  it('accepts and persists display_name + color', () => {
    const store = useUserStore()
    expect(store.setDisplayName('Alice')).toBe(null)
    expect(store.setColor('#ff00aa')).toBe(null)
    expect(store.isConfigured).toBe(true)
    const raw = localStorage.getItem(USER_STORAGE_KEY)
    expect(store.settings.display_name).toBe('Alice')
    expect(store.settings.color).toBe('#ff00aa')
    expect(JSON.parse(raw)).toMatchObject({ display_name: 'Alice', color: '#ff00aa' })
  })

  it('trims whitespace on display_name', () => {
    const store = useUserStore()
    store.setDisplayName('  Alice  ')
    expect(store.settings.display_name).toBe('Alice')
  })

  it('rejects invalid color format', () => {
    const store = useUserStore()
    const err = store.setColor('not-a-color')
    expect(err).toMatch(/hex/i)
    expect(store.settings.color).not.toBe('not-a-color')
  })

  it('reset clears settings', () => {
    const store = useUserStore()
    store.setDisplayName('Alice')
    store.reset()
    expect(store.settings.display_name).toBe('')
  })

  it('loads from localStorage on creation', () => {
    localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({ display_name: 'Bob', color: '#112233', created_at: '2025-01-01' }),
    )
    setActivePinia(createPinia())
    const store = useUserStore()
    expect(store.settings.display_name).toBe('Bob')
    expect(store.settings.color).toBe('#112233')
    expect(store.isConfigured).toBe(true)
  })

  it('reports session-only identity changes immediately and clears the error after saving succeeds', async () => {
    const store = useUserStore()
    store.setDisplayName('Saved identity')
    await nextTick()
    const persisted = localStorage.getItem(USER_STORAGE_KEY)
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-storage-diagnostic') })

    expect(store.setDisplayName('Session identity')).toBeNull()
    expect(write).toHaveBeenCalled()
    expect(store.display_name).toBe('Session identity')
    expect(store.storageError).toMatch(/this session/i)
    expect(store.storageError).not.toContain('private-storage-diagnostic')
    expect(localStorage.getItem(USER_STORAGE_KEY)).toBe(persisted)
    setActivePinia(createPinia())
    expect(useUserStore().display_name).toBe('Saved identity')

    write.mockRestore()
    expect(store.setColor('#112233')).toBeNull()
    expect(store.storageError).toBe('')
    setActivePinia(createPinia())
    expect(useUserStore().display_name).toBe('Session identity')
    expect(useUserStore().color).toBe('#112233')
  })

  it('retries saving the exact unchanged session identity only when requested', () => {
    const store = useUserStore()
    store.setDisplayName('Saved identity')
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    store.setDisplayName('Session identity')
    store.setColor('#112233')
    const snapshot = JSON.stringify(store.settings)
    expect(store.retryPersistence()).toBe(false)
    write.mockRestore()
    expect(store.retryPersistence()).toBe(true)
    expect(store.storageError).toBe('')
    expect(JSON.stringify(store.settings)).toBe(snapshot)
    setActivePinia(createPinia())
    expect(JSON.stringify(useUserStore().settings)).toBe(snapshot)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorPreferencesStore } from '@/stores/editorPreferencesStore'

const key = 'range42_editor_preferences'
beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()); vi.restoreAllMocks() })

describe('persistent editor preferences', () => {
  it('restores explicit false values and saves changes for a fresh app instance', () => {
    localStorage.setItem(key, JSON.stringify({ autoSaveToGit: false, snapToGrid: false, gridSize: 35 }))
    const preferences = useEditorPreferencesStore()
    expect(preferences.autoSaveToGit).toBe(false)
    expect(preferences.snapToGrid).toBe(false)
    expect(preferences.gridSize).toBe(35)
    preferences.gridSize = 40
    setActivePinia(createPinia())
    expect(useEditorPreferencesStore().gridSize).toBe(40)
  })

  it.each(['{', 'null', '[]', '"invalid"', '{"autoSaveToGit":"false","snapToGrid":1,"gridSize":999}', '{"gridSize":20.5}'])('restores safe defaults for invalid saved data: %s', saved => {
    localStorage.setItem(key, saved)
    const preferences = useEditorPreferencesStore()
    expect(preferences.autoSaveToGit).toBe(true)
    expect(preferences.snapToGrid).toBe(true)
    expect(preferences.gridSize).toBe(20)
  })

  it.each([10, 50])('accepts the bounded grid spacing %s', gridSize => {
    localStorage.setItem(key, JSON.stringify({ gridSize }))
    expect(useEditorPreferencesStore().gridSize).toBe(gridSize)
  })

  it('keeps session preferences usable and reports storage failure without throwing', () => {
    const preferences = useEditorPreferencesStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    expect(() => { preferences.autoSaveToGit = false }).not.toThrow()
    expect(preferences.autoSaveToGit).toBe(false)
    expect(preferences.storageError).toContain('this session')
  })
})

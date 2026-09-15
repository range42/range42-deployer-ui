import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'

describe('checked local project import boundary', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the local project list when clearing storage is refused', () => {
    const store = useProjectStore()
    store.createProject('Keep this draft')
    const stored = localStorage.getItem('range42_projects')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    try {
      expect(() => store.clearAllData()).toThrow('Browser storage')
      expect(store.projects).toHaveLength(1)
      expect(localStorage.getItem('range42_projects')).toBe(stored)
    } finally { setItem.mockRestore() }
  })

  it('creates a complete empty canvas including its attachment collection', () => {
    const project = useProjectStore().createProject('Draft')
    expect(project.attachments).toEqual([])
    expect(JSON.parse(localStorage.getItem('range42_projects'))[0].attachments).toEqual([])
  })

  it('rejects a non-text file result without changing existing projects', async () => {
    const store = useProjectStore()
    store.createProject('Existing')
    const before = localStorage.getItem('range42_projects')
    vi.stubGlobal('FileReader', class {
      result = new ArrayBuffer(2)
      readAsText() { this.onload({ target: this }) }
    })
    await expect(store.importProjectFromFile(new File(['ignored'], 'project.json'))).rejects.toThrow('Project file did not contain text')
    expect(localStorage.getItem('range42_projects')).toBe(before)
    expect(store.projects).toHaveLength(1)
  })
})

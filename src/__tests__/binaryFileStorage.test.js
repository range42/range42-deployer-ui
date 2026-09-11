import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryFs } from '@/services/projectRepo/memoryFs'
import { assetFromBytes, fileBytes } from '@/services/projectFiles'
import { useProjectStore } from '@/stores/projectStore'
const asset = assetFromBytes(Uint8Array.of(0, 255, 10), 'application/test')

beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })

describe('binary authored-file storage', () => {
  it('rejects imported authored manifest collisions before storing the project', () => {
    const store = useProjectStore()
    expect(() => store.importProject({ name: 'Bad', nodes: [], edges: [], files: { 'meta.json': '{}' } })).toThrow(/reserved/i)
    expect(store.projects).toHaveLength(0)
  })

  it('lists binary files, reads them losslessly, and rejects text-editor access', async () => {
    const fs = createMemoryFs({ files: { 'content/asset.bin': asset } })
    expect(await fs.listTree()).toEqual([expect.objectContaining({ path: 'content/asset.bin', binary: true, size: 3 })])
    expect(Array.from(fileBytes((await fs.getFileContent('content/asset.bin')).content))).toEqual([0, 255, 10])
    await expect(fs.getFile('content/asset.bin')).rejects.toThrow(/binary.*text/i)
  })
  it('keeps the previous memory file when persistence rejects the new asset', async () => {
    const files = { 'content/file.txt': 'before' }
    const fs = createMemoryFs({ files, onChange: () => { throw new Error('Storage quota exceeded') } })
    await expect(fs.putFile({ path: 'content/file.txt', content: asset })).rejects.toThrow(/quota/)
    expect((await fs.getFile('content/file.txt')).content).toBe('before')
    expect(files['content/file.txt']).toBe('before')
  })
  it('preserves imported tagged assets through project reload', () => {
    const store = useProjectStore()
    store.importProject({ id: 'binary', name: 'Binary', nodes: [], edges: [], files: { 'content/a.bin': asset } }, { generateNewId: false })
    store.loadProjects()
    expect(store.getProject('binary')?.files['content/a.bin']).toEqual(asset)
  })
  it('rejects forged asset sizes before importing a project', () => {
    const store = useProjectStore()
    expect(() => store.importProject({ name: 'Bad', nodes: [], edges: [], files: { 'content/a.bin': { ...asset, size: 8 } } })).toThrow(/size/)
    expect(store.projects).toHaveLength(0)
  })
  it('reports quota failure before changing project files or existing browser storage', () => {
    const store = useProjectStore()
    store.importProject({ id: 'binary', name: 'Binary', nodes: [], edges: [], files: { 'content/file.txt': 'before' } }, { generateNewId: false })
    const saved = localStorage.getItem('range42_projects')
    const storage = globalThis.localStorage
    // jsdom Storage uses a proxy: spying on an instance method can create a
    // storage entry instead of replacing the method on supported Node 24.
    vi.stubGlobal('localStorage', {
      getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    })
    try {
      expect(() => store.updateProject('binary', { files: { 'content/a.bin': asset } })).toThrow(/browser storage.*full.*remove|quota/i)
      expect(store.getProject('binary')?.files).toEqual({ 'content/file.txt': 'before' })
      expect(localStorage.getItem('range42_projects')).toBe(saved)
    } finally { vi.unstubAllGlobals() }
  })
})

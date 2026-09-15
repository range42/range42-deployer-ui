import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

interface EditorPreferences {
  autoSaveToGit: boolean
  snapToGrid: boolean
  gridSize: number
}

const storageKey = 'range42_editor_preferences'
const defaults: EditorPreferences = { autoSaveToGit: true, snapToGrid: true, gridSize: 20 }

function readPreferences(): EditorPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...defaults }
    const value = saved as Record<string, unknown>
    return {
      autoSaveToGit: typeof value.autoSaveToGit === 'boolean' ? value.autoSaveToGit : defaults.autoSaveToGit,
      snapToGrid: typeof value.snapToGrid === 'boolean' ? value.snapToGrid : defaults.snapToGrid,
      gridSize: typeof value.gridSize === 'number' && Number.isInteger(value.gridSize) && value.gridSize >= 10 && value.gridSize <= 50
        ? value.gridSize : defaults.gridSize,
    }
  } catch { return { ...defaults } }
}

export const useEditorPreferencesStore = defineStore('editorPreferences', () => {
  const saved = readPreferences()
  const autoSaveToGit = ref(saved.autoSaveToGit)
  const snapToGrid = ref(saved.snapToGrid)
  const gridSize = ref(saved.gridSize)
  const storageError = ref('')
  watch([autoSaveToGit, snapToGrid, gridSize], () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ autoSaveToGit: autoSaveToGit.value, snapToGrid: snapToGrid.value, gridSize: gridSize.value }))
      storageError.value = ''
    } catch { storageError.value = 'Preferences could not be stored. Changes apply only in this session.' }
  }, { flush: 'sync' })
  return { autoSaveToGit, snapToGrid, gridSize, storageError }
})

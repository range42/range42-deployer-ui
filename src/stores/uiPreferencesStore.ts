import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

type Theme = 'system' | 'light' | 'dark'
const storageKey = 'range42_ui_preferences'

function readPreferences(): { collapsed: boolean; theme: Theme } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return { collapsed: saved?.collapsed === true,
      theme: saved?.theme === 'light' || saved?.theme === 'dark' ? saved.theme : 'system' }
  } catch { return { collapsed: false, theme: 'system' } }
}

export const useUiPreferencesStore = defineStore('uiPreferences', () => {
  const saved = readPreferences()
  const collapsed = ref(saved.collapsed)
  const theme = ref<Theme>(saved.theme)
  watch([collapsed, theme], () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ collapsed: collapsed.value, theme: theme.value })) }
    catch { /* Preferences remain usable for this session without persistent storage. */ }
  }, { flush: 'sync' })
  return { collapsed, theme }
})

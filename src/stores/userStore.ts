/**
 * User Store — minimal per-browser identity for lock stamps + commit metadata.
 *
 * Plan C §C5.4: `display_name` is required and validated non-empty; the color
 * (HSL-friendly hex) is used on `.lock` file stamps so collaborators can tell
 * whose session is editing. Storage key: `range42_user_settings`.
 *
 * This store deliberately stays minimal — richer identity (avatar, email) is
 * sourced from the git provider's OAuth/PAT identity, not from here.
 */

import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'

export const USER_STORAGE_KEY = 'range42_user_settings'

export interface UserSettings {
  display_name: string
  color: string
  created_at: string
}

const DEFAULT_COLOR = '#3b82f6' // tailwind blue-500

export function createEmptyUserSettings(): UserSettings {
  return {
    display_name: '',
    color: DEFAULT_COLOR,
    created_at: new Date().toISOString(),
  }
}

export function validateDisplayName(name: string): string | null {
  if (!name || !name.trim()) return 'Display name is required.'
  if (name.trim().length > 64) return 'Display name must be 64 characters or fewer.'
  return null
}

export function validateColor(color: string): string | null {
  if (!color) return 'Color is required.'
  // Accept #rgb, #rrggbb, or #rrggbbaa
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    return 'Color must be a hex value (e.g. #3b82f6).'
  }
  return null
}

export const useUserStore = defineStore('user', () => {
  function load(): UserSettings {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return { ...createEmptyUserSettings(), ...parsed }
      }
    } catch {
      /* ignore */
    }
    return createEmptyUserSettings()
  }

  const settings = ref<UserSettings>(load())

  watch(
    settings,
    (next) => {
      try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  )

  const display_name = computed(() => settings.value.display_name)
  const color = computed(() => settings.value.color)
  const isConfigured = computed(() => validateDisplayName(settings.value.display_name) === null)

  function setDisplayName(name: string): string | null {
    const err = validateDisplayName(name)
    if (err) return err
    settings.value.display_name = name.trim()
    if (!settings.value.created_at) {
      settings.value.created_at = new Date().toISOString()
    }
    return null
  }

  function setColor(nextColor: string): string | null {
    const err = validateColor(nextColor)
    if (err) return err
    settings.value.color = nextColor
    return null
  }

  function reset() {
    settings.value = createEmptyUserSettings()
  }

  return {
    settings,
    display_name,
    color,
    isConfigured,
    setDisplayName,
    setColor,
    reset,
  }
})

export default useUserStore

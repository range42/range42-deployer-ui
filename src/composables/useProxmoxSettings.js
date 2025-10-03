import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

/**
 * Cookie-based Proxmox settings store
 * Stores BASE_URL and DEFAULT_NODE per project
 * Future-proof: can be migrated to backend storage by swapping adapter
 */

const COOKIE_PREFIX = 'range42.proxmox'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds
export const DEFAULT_PROXMOX_BASE_DOMAIN = 'http://127.0.0.1:8000'

export function normalizeProxmoxBaseUrl(baseUrl, fallback = DEFAULT_PROXMOX_BASE_DOMAIN) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return fallback
  }

  let normalized = baseUrl.trim()
  if (!normalized) {
    return fallback
  }

  const v0Index = normalized.indexOf('/v0/')
  if (v0Index !== -1) {
    normalized = normalized.slice(0, v0Index)
  }

  normalized = normalized.replace(/\s+/g, '')
  normalized = normalized.replace(/\/+$/, '')

  if (!/^https?:\/\//i.test(normalized)) {
    return fallback
  }

  return normalized || fallback
}

// Cookie helper functions
function getCookie(name) {
  const nameEQ = name + '='
  const ca = document.cookie.split(';')
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i]
    while (c.charAt(0) === ' ') c = c.substring(1, c.length)
    if (c.indexOf(nameEQ) === 0) {
      try {
        return JSON.parse(decodeURIComponent(c.substring(nameEQ.length, c.length)))
      } catch (e) {
        console.warn('Failed to parse cookie:', name, e)
        return null
      }
    }
  }
  return null
}

function setCookie(name, value, maxAge = COOKIE_MAX_AGE) {
  const expires = maxAge ? `; max-age=${maxAge}` : ''
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}${expires}; path=/; SameSite=Lax${secure}`
}

function deleteCookie(name) {
  document.cookie = `${name}=; path=/; max-age=0`
}

export const useProxmoxSettingsStore = defineStore('proxmoxSettings', () => {
  // Reactive state
  const settings = ref({})

  /**
   * Load settings for a specific project from cookie
   */
  const loadProjectSettings = (projectId) => {
    if (!projectId) return null
    
    const cookieName = `${COOKIE_PREFIX}.${projectId}`
    const stored = getCookie(cookieName)
    
    if (stored && stored.baseUrl && stored.defaultNode) {
      const normalizedBase = normalizeProxmoxBaseUrl(stored.baseUrl)
      const normalizedSettings = {
        baseUrl: normalizedBase,
        defaultNode: stored.defaultNode,
        updatedAt: stored.updatedAt || new Date().toISOString()
      }

      settings.value[projectId] = normalizedSettings

      if (normalizedBase !== stored.baseUrl) {
        const cookieName = `${COOKIE_PREFIX}.${projectId}`
        setCookie(cookieName, normalizedSettings)
      }

      return normalizedSettings
    }
    
    return null
  }

  /**
   * Save settings for a specific project to cookie
   */
  const saveProjectSettings = (projectId, { baseUrl, defaultNode }) => {
    if (!projectId) {
      console.error('Project ID required to save Proxmox settings')
      return false
    }

    if (!baseUrl || !defaultNode) {
      console.error('Both baseUrl and defaultNode are required')
      return false
    }

    const normalizedBase = normalizeProxmoxBaseUrl(baseUrl)
    const settingsData = {
      baseUrl: normalizedBase,
      defaultNode,
      updatedAt: new Date().toISOString()
    }

    const cookieName = `${COOKIE_PREFIX}.${projectId}`
    setCookie(cookieName, settingsData)
    
    settings.value[projectId] = settingsData
    return true
  }

  /**
   * Get settings for a project (from memory or cookie)
   */
  const getProjectSettings = (projectId) => {
    if (!projectId) return null
    
    // Check memory first
    if (settings.value[projectId]) {
      return settings.value[projectId]
    }
    
    // Load from cookie
    return loadProjectSettings(projectId)
  }

  /**
   * Delete settings for a project
   */
  const deleteProjectSettings = (projectId) => {
    if (!projectId) return
    
    const cookieName = `${COOKIE_PREFIX}.${projectId}`
    deleteCookie(cookieName)
    delete settings.value[projectId]
  }

  /**
   * Check if project has valid settings
   */
  const hasValidSettings = (projectId) => {
    const projectSettings = getProjectSettings(projectId)
    return !!(projectSettings?.baseUrl && projectSettings?.defaultNode)
  }

  /**
   * Clear all Proxmox settings (for all projects)
   */
  const clearAllSettings = () => {
    // Clear memory
    const projectIds = Object.keys(settings.value)
    projectIds.forEach(id => deleteProjectSettings(id))
    settings.value = {}
  }

  return {
    settings: computed(() => settings.value),
    loadProjectSettings,
    saveProjectSettings,
    getProjectSettings,
    deleteProjectSettings,
    hasValidSettings,
    clearAllSettings
  }
})

/**
 * Composable for using Proxmox settings in components
 * Provides reactive access to current project's Proxmox configuration
 */
export function useProxmoxSettings(projectId) {
  const store = useProxmoxSettingsStore()
  
  const currentSettings = computed(() => {
    return projectId?.value 
      ? store.getProjectSettings(projectId.value)
      : null
  })

  const baseUrl = computed(() => currentSettings.value?.baseUrl || null)
  const defaultNode = computed(() => currentSettings.value?.defaultNode || null)
  const isConfigured = computed(() => store.hasValidSettings(projectId?.value))
  const updatedAt = computed(() => currentSettings.value?.updatedAt || null)

  const updateSettings = (baseUrl, defaultNode) => {
    if (!projectId?.value) {
      console.error('Project ID required')
      return false
    }
    return store.saveProjectSettings(projectId.value, { baseUrl, defaultNode })
  }

  const resetSettings = () => {
    if (projectId?.value) {
      store.deleteProjectSettings(projectId.value)
    }
  }

  return {
    baseUrl,
    defaultNode,
    isConfigured,
    updatedAt,
    updateSettings,
    resetSettings,
    currentSettings
  }
}

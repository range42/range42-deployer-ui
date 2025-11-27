import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

/**
 * Cookie-based Backend API settings store
 * 
 * Stores per-project configuration for connecting to the Range42 Backend API:
 * - backendApiUrl: The URL of the backend-api service (e.g., http://192.168.1.100:8000)
 * - proxmoxNode: The target Proxmox node name (e.g., pve, px-testing)
 * 
 * The Backend API then communicates with Proxmox via Ansible.
 * 
 * Future-proof: can be migrated to backend storage by swapping adapter
 */

const COOKIE_PREFIX = 'range42.settings'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

// Default Backend API URL (the backend-api service, NOT Proxmox directly)
export const DEFAULT_BACKEND_API_URL = 'http://127.0.0.1:8000'

// Legacy alias for backwards compatibility
export const DEFAULT_PROXMOX_BASE_DOMAIN = DEFAULT_BACKEND_API_URL

/**
 * Normalize a backend API URL
 * - Strips trailing slashes
 * - Removes /v0/ path if accidentally included
 * - Ensures http:// or https:// prefix
 */
export function normalizeBackendApiUrl(baseUrl, fallback = DEFAULT_BACKEND_API_URL) {
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

// Legacy alias for backwards compatibility
export const normalizeProxmoxBaseUrl = normalizeBackendApiUrl

export const useProxmoxSettingsStore = defineStore('proxmoxSettings', () => {
  // Reactive state
  const settings = ref({})

  /**
   * Load settings for a specific project from cookie
   */
  const loadProjectSettings = (projectId) => {
    if (!projectId) return null
    
    // Try new cookie name first, then legacy
    let cookieName = `${COOKIE_PREFIX}.${projectId}`
    let stored = getCookie(cookieName)
    
    // Fallback to legacy cookie name
    if (!stored) {
      const legacyCookieName = `range42.proxmox.${projectId}`
      stored = getCookie(legacyCookieName)
      if (stored) {
        // Migrate to new cookie name
        setCookie(cookieName, stored)
        deleteCookie(legacyCookieName)
      }
    }
    
    // Support both old field names (baseUrl) and new (backendApiUrl)
    const apiUrl = stored?.backendApiUrl || stored?.baseUrl
    const node = stored?.proxmoxNode || stored?.defaultNode
    
    if (stored && apiUrl && node) {
      const normalizedBase = normalizeBackendApiUrl(apiUrl)
      const normalizedSettings = {
        backendApiUrl: normalizedBase,
        proxmoxNode: node,
        // Legacy aliases
        baseUrl: normalizedBase,
        defaultNode: node,
        updatedAt: stored.updatedAt || new Date().toISOString()
      }

      settings.value[projectId] = normalizedSettings

      // Re-save if normalized
      if (normalizedBase !== apiUrl) {
        setCookie(cookieName, normalizedSettings)
      }

      return normalizedSettings
    }
    
    return null
  }

  /**
   * Save settings for a specific project to cookie
   * @param {string} projectId 
   * @param {Object} param1 - Settings object with backendApiUrl and proxmoxNode (or legacy baseUrl/defaultNode)
   */
  const saveProjectSettings = (projectId, { backendApiUrl, proxmoxNode, baseUrl, defaultNode }) => {
    if (!projectId) {
      console.error('Project ID required to save settings')
      return false
    }

    // Support both new and legacy field names
    const apiUrl = backendApiUrl || baseUrl
    const node = proxmoxNode || defaultNode

    if (!apiUrl || !node) {
      console.error('Both backendApiUrl and proxmoxNode are required')
      return false
    }

    const normalizedBase = normalizeBackendApiUrl(apiUrl)
    const settingsData = {
      backendApiUrl: normalizedBase,
      proxmoxNode: node,
      // Legacy aliases for backwards compatibility
      baseUrl: normalizedBase,
      defaultNode: node,
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
    return !!(projectSettings?.backendApiUrl && projectSettings?.proxmoxNode)
  }

  /**
   * Clear all settings (for all projects)
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
 * Composable for using Backend API settings in components
 * Provides reactive access to current project's configuration
 * 
 * @param {Ref<string>} projectId - Reactive project ID reference
 */
export function useProxmoxSettings(projectId) {
  const store = useProxmoxSettingsStore()
  
  const currentSettings = computed(() => {
    return projectId?.value 
      ? store.getProjectSettings(projectId.value)
      : null
  })

  // New field names
  const backendApiUrl = computed(() => currentSettings.value?.backendApiUrl || null)
  const proxmoxNode = computed(() => currentSettings.value?.proxmoxNode || null)
  
  // Legacy aliases for backwards compatibility
  const baseUrl = backendApiUrl
  const defaultNode = proxmoxNode
  
  const isConfigured = computed(() => store.hasValidSettings(projectId?.value))
  const updatedAt = computed(() => currentSettings.value?.updatedAt || null)

  /**
   * Update settings for the current project
   * @param {string} apiUrl - Backend API URL
   * @param {string} node - Proxmox node name
   */
  const updateSettings = (apiUrl, node) => {
    if (!projectId?.value) {
      console.error('Project ID required')
      return false
    }
    return store.saveProjectSettings(projectId.value, { 
      backendApiUrl: apiUrl, 
      proxmoxNode: node 
    })
  }

  const resetSettings = () => {
    if (projectId?.value) {
      store.deleteProjectSettings(projectId.value)
    }
  }

  return {
    // New field names (preferred)
    backendApiUrl,
    proxmoxNode,
    // Legacy aliases (for backwards compatibility)
    baseUrl,
    defaultNode,
    // Status
    isConfigured,
    updatedAt,
    // Methods
    updateSettings,
    resetSettings,
    currentSettings
  }
}

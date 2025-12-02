/**
 * Proxmox Settings Store
 * 
 * Manages Proxmox connection settings including:
 * - Base URL for API calls
 * - Default node for operations
 * - Default storage for templates/ISOs
 * 
 * Settings are persisted to localStorage.
 */

import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'range42_proxmox_settings'

const DEFAULT_SETTINGS = {
  baseUrl: '',
  defaultNode: 'pve',
  defaultStorage: 'local',
  apiTokenId: '',
  apiTokenSecret: '',
  verifySSL: true,
}

// =============================================================================
// Types
// =============================================================================

export interface ProxmoxSettings {
  baseUrl: string
  defaultNode: string
  defaultStorage: string
  apiTokenId: string
  apiTokenSecret: string
  verifySSL: boolean
}

// =============================================================================
// Store
// =============================================================================

export const useProxmoxSettingsStore = defineStore('proxmoxSettings', () => {
  // Load from localStorage
  const loadSettings = (): ProxmoxSettings => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      }
    } catch (e) {
      console.warn('[ProxmoxSettings] Failed to load settings:', e)
    }
    return { ...DEFAULT_SETTINGS }
  }

  // State
  const settings = ref<ProxmoxSettings>(loadSettings())

  // Computed getters for individual settings
  const baseUrl = computed(() => settings.value.baseUrl)
  const defaultNode = computed(() => settings.value.defaultNode)
  const defaultStorage = computed(() => settings.value.defaultStorage)
  const apiTokenId = computed(() => settings.value.apiTokenId)
  const apiTokenSecret = computed(() => settings.value.apiTokenSecret)
  const verifySSL = computed(() => settings.value.verifySSL)

  // Check if configured
  const isConfigured = computed(() => {
    return !!settings.value.baseUrl && !!settings.value.defaultNode
  })

  // Persist to localStorage on changes
  watch(settings, (newSettings) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings))
    } catch (e) {
      console.warn('[ProxmoxSettings] Failed to save settings:', e)
    }
  }, { deep: true })

  // Actions
  function updateSettings(newSettings: Partial<ProxmoxSettings>) {
    settings.value = { ...settings.value, ...newSettings }
  }

  function setBaseUrl(url: string) {
    settings.value.baseUrl = url
  }

  function setDefaultNode(node: string) {
    settings.value.defaultNode = node
  }

  function setDefaultStorage(storage: string) {
    settings.value.defaultStorage = storage
  }

  function setApiToken(tokenId: string, tokenSecret: string) {
    settings.value.apiTokenId = tokenId
    settings.value.apiTokenSecret = tokenSecret
  }

  function resetToDefaults() {
    settings.value = { ...DEFAULT_SETTINGS }
  }

  function clearSettings() {
    localStorage.removeItem(STORAGE_KEY)
    settings.value = { ...DEFAULT_SETTINGS }
  }

  return {
    // State
    settings,

    // Computed
    baseUrl,
    defaultNode,
    defaultStorage,
    apiTokenId,
    apiTokenSecret,
    verifySSL,
    isConfigured,

    // Actions
    updateSettings,
    setBaseUrl,
    setDefaultNode,
    setDefaultStorage,
    setApiToken,
    resetToDefaults,
    clearSettings,
  }
})

export default useProxmoxSettingsStore

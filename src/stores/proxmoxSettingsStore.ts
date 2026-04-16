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
const HOSTS_STORAGE_KEY = 'range42_proxmox_hosts'

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

/**
 * Plan C §18.4 / §C5.4 — `proxmox_host` record. Each entry is a
 * registered Proxmox API endpoint with its own credentials and optional
 * health snapshot from the last `/v1/proxmox/hosts/{id}/health` probe.
 */
export interface ProxmoxHost {
  id: string
  name: string
  base_url: string
  default_node: string
  api_token_id?: string
  api_token_secret?: string
  verify_ssl: boolean
  health?: {
    status: 'ok' | 'degraded' | 'down' | 'unknown'
    rtt_ms?: number
    checked_at?: string
    error?: string
    aggregate_storage_gb?: number
  }
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

  const loadHosts = (): ProxmoxHost[] => {
    try {
      const stored = localStorage.getItem(HOSTS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return parsed as ProxmoxHost[]
      }
    } catch (e) {
      console.warn('[ProxmoxSettings] Failed to load hosts:', e)
    }
    return []
  }

  // State
  const settings = ref<ProxmoxSettings>(loadSettings())
  const hosts = ref<ProxmoxHost[]>(loadHosts())

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

  watch(hosts, (next) => {
    try {
      localStorage.setItem(HOSTS_STORAGE_KEY, JSON.stringify(next))
    } catch (e) {
      console.warn('[ProxmoxSettings] Failed to save hosts:', e)
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

  // -------------------------------------------------------------------------
  // Proxmox hosts (Plan C §18.4) — multi-host registry for Settings page
  // -------------------------------------------------------------------------

  function addHost(host: Omit<ProxmoxHost, 'id'> & { id?: string }): ProxmoxHost {
    if (!host.name || !host.base_url) {
      throw new Error('Host requires name and base_url')
    }
    const id =
      host.id ||
      `pxh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    if (hosts.value.some((h) => h.id === id)) {
      throw new Error(`Host with id ${id} already exists`)
    }
    const entry: ProxmoxHost = {
      id,
      name: host.name,
      base_url: host.base_url,
      default_node: host.default_node || 'pve',
      api_token_id: host.api_token_id,
      api_token_secret: host.api_token_secret,
      verify_ssl: host.verify_ssl !== false,
    }
    hosts.value.push(entry)
    return entry
  }

  function removeHost(id: string) {
    const idx = hosts.value.findIndex((h) => h.id === id)
    if (idx >= 0) hosts.value.splice(idx, 1)
  }

  function updateHostHealth(id: string, health: ProxmoxHost['health']) {
    const h = hosts.value.find((h) => h.id === id)
    if (h) h.health = health ? { ...health } : undefined
  }

  function getHost(id: string) {
    return hosts.value.find((h) => h.id === id)
  }

  return {
    // State
    settings,
    hosts,

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
    addHost,
    removeHost,
    updateHostHealth,
    getHost,
  }
})

export default useProxmoxSettingsStore

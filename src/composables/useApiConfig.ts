/**
 * API Configuration Composable
 * 
 * Bridges the project settings store with the Proxmox API client.
 * Automatically configures the API client when settings change.
 * 
 * Usage:
 *   const { isReady, configure, apiUrl, node } = useApiConfig(projectIdRef)
 *   
 *   // In component setup or before API calls:
 *   if (isReady.value) {
 *     configure() // Sets up api.ts with current settings
 *     await proxmoxApi.vm.list(node.value)
 *   }
 */

import { computed, watch, type Ref } from 'vue'
import { useProxmoxSettings, DEFAULT_BACKEND_API_URL } from './useProxmoxSettings'
import { setBaseUrl, getBaseUrl } from '@/services/proxmox/api'

export interface ApiConfigOptions {
  /** Auto-configure API when settings change */
  autoSync?: boolean
}

export function useApiConfig(projectId: Ref<string | null | undefined>, options: ApiConfigOptions = {}) {
  const { autoSync = false } = options
  
  // Get settings for the project
  const settings = useProxmoxSettings(projectId as Ref<string>)
  
  // Computed values
  const apiUrl = computed(() => settings.backendApiUrl.value || DEFAULT_BACKEND_API_URL)
  const node = computed(() => settings.proxmoxNode.value || '')
  const isConfigured = computed(() => settings.isConfigured.value)
  const isReady = computed(() => !!(settings.backendApiUrl.value && settings.proxmoxNode.value))
  
  /**
   * Configure the API client with current settings
   * Call this before making API requests
   */
  function configure(): boolean {
    if (!settings.backendApiUrl.value) {
      console.warn('Cannot configure API: backendApiUrl not set')
      return false
    }
    
    setBaseUrl(settings.backendApiUrl.value)
    return true
  }
  
  /**
   * Check if API is configured with current settings
   */
  function isApiConfigured(): boolean {
    const currentBaseUrl = getBaseUrl()
    return currentBaseUrl === settings.backendApiUrl.value
  }
  
  /**
   * Ensure API is configured, configure if needed
   */
  function ensureConfigured(): boolean {
    if (!isApiConfigured()) {
      return configure()
    }
    return true
  }
  
  // Auto-sync if enabled
  if (autoSync) {
    watch(
      () => settings.backendApiUrl.value,
      (newUrl) => {
        if (newUrl) {
          setBaseUrl(newUrl)
        }
      },
      { immediate: true }
    )
  }
  
  return {
    // State
    apiUrl,
    node,
    isConfigured,
    isReady,
    
    // Legacy aliases
    backendApiUrl: apiUrl,
    proxmoxNode: node,
    baseUrl: apiUrl,
    defaultNode: node,
    
    // Methods
    configure,
    isApiConfigured,
    ensureConfigured,
    
    // Access to underlying settings
    settings,
  }
}

export default useApiConfig

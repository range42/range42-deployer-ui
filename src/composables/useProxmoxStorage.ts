/**
 * Proxmox Storage Composable
 * 
 * Provides access to Proxmox storage resources including:
 * - VM Templates (for cloning)
 * - ISO images (for fresh installations)
 * - Storage pool information
 */

import { ref, computed } from 'vue'
import { proxmoxApi, type IsoInfo, type TemplateInfo } from '@/services/proxmox'
import { useProxmoxSettingsStore } from '@/stores/proxmoxSettingsStore'

// =============================================================================
// Types
// =============================================================================

export interface StorageInfo {
  storage: string
  type: string
  content: string
  active: boolean
  enabled: boolean
  shared: boolean
  total?: number
  used?: number
  avail?: number
}

export interface StorageContent {
  templates: TemplateInfo[]
  isos: IsoInfo[]
}

export interface UseProxmoxStorageOptions {
  autoLoad?: boolean
  defaultStorage?: string
}

// =============================================================================
// Composable
// =============================================================================

export function useProxmoxStorage(options: UseProxmoxStorageOptions = {}) {
  const settingsStore = useProxmoxSettingsStore()

  // State
  const storagePools = ref<StorageInfo[]>([])
  const templates = ref<TemplateInfo[]>([])
  const isos = ref<IsoInfo[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedStorage = ref<string>(options.defaultStorage || 'local')

  // Computed
  const isConfigured = computed(() => {
    return !!settingsStore.baseUrl && !!settingsStore.defaultNode
  })

  const proxmoxNode = computed(() => settingsStore.defaultNode || 'pve')

  const templateStorages = computed(() => {
    return storagePools.value.filter(s => 
      s.content?.includes('images') || s.content?.includes('vztmpl')
    )
  })

  const isoStorages = computed(() => {
    return storagePools.value.filter(s => s.content?.includes('iso'))
  })

  // Group templates by category (based on name patterns)
  const groupedTemplates = computed(() => {
    const groups: Record<string, TemplateInfo[]> = {
      'Linux': [],
      'Windows': [],
      'Router/Firewall': [],
      'Other': [],
    }

    for (const template of templates.value) {
      const name = template.name.toLowerCase()
      if (name.includes('windows') || name.includes('win')) {
        groups['Windows'].push(template)
      } else if (name.includes('pfsense') || name.includes('opnsense') || name.includes('vyos') || name.includes('router') || name.includes('firewall')) {
        groups['Router/Firewall'].push(template)
      } else if (name.includes('ubuntu') || name.includes('debian') || name.includes('centos') || name.includes('rocky') || name.includes('alma') || name.includes('linux')) {
        groups['Linux'].push(template)
      } else {
        groups['Other'].push(template)
      }
    }

    // Remove empty groups
    return Object.fromEntries(
      Object.entries(groups).filter(([, items]) => items.length > 0)
    )
  })

  // =============================================================================
  // Actions
  // =============================================================================

  /**
   * Load storage pools from Proxmox
   */
  async function loadStoragePools(): Promise<void> {
    if (!isConfigured.value) {
      error.value = 'Proxmox not configured'
      return
    }

    try {
      isLoading.value = true
      error.value = null
      const result = await proxmoxApi.storage.list(proxmoxNode.value)
      storagePools.value = result as StorageInfo[]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[useProxmoxStorage] Failed to load storage pools:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Load templates from a specific storage
   */
  async function loadTemplates(storage?: string): Promise<void> {
    if (!isConfigured.value) {
      error.value = 'Proxmox not configured'
      return
    }

    const storageId = storage || selectedStorage.value

    try {
      isLoading.value = true
      error.value = null
      templates.value = await proxmoxApi.storage.listTemplates(proxmoxNode.value, storageId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[useProxmoxStorage] Failed to load templates:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Load ISOs from a specific storage
   */
  async function loadIsos(storage?: string): Promise<void> {
    if (!isConfigured.value) {
      error.value = 'Proxmox not configured'
      return
    }

    const storageId = storage || selectedStorage.value

    try {
      isLoading.value = true
      error.value = null
      isos.value = await proxmoxApi.storage.listIsos(proxmoxNode.value, storageId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[useProxmoxStorage] Failed to load ISOs:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Load all content from selected storage
   */
  async function loadAll(storage?: string): Promise<void> {
    const storageId = storage || selectedStorage.value
    selectedStorage.value = storageId

    await Promise.all([
      loadStoragePools(),
      loadTemplates(storageId),
      loadIsos(storageId),
    ])
  }

  /**
   * Refresh all data
   */
  async function refresh(): Promise<void> {
    await loadAll()
  }

  /**
   * Download ISO from URL
   */
  async function downloadIso(url: string, filename: string, checksum?: string): Promise<void> {
    if (!isConfigured.value) {
      error.value = 'Proxmox not configured'
      return
    }

    try {
      isLoading.value = true
      error.value = null
      await proxmoxApi.storage.downloadIso({
        proxmox_node: proxmoxNode.value,
        storage: selectedStorage.value,
        url,
        filename,
        checksum,
      })
      // Refresh ISO list after download
      await loadIsos()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Format file size for display
   */
  function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // Auto-load if configured
  if (options.autoLoad && isConfigured.value) {
    loadAll()
  }

  return {
    // State
    storagePools,
    templates,
    isos,
    isLoading,
    error,
    selectedStorage,

    // Computed
    isConfigured,
    templateStorages,
    isoStorages,
    groupedTemplates,

    // Actions
    loadStoragePools,
    loadTemplates,
    loadIsos,
    loadAll,
    refresh,
    downloadIso,
    formatSize,
  }
}

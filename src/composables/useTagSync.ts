import { ref } from 'vue'
import { parseTags, formatTagsForBackend } from '@/constants/tags'
import * as proxmoxApi from '@/services/proxmox/api'

export function useTagSync() {
  const lastSyncTime = ref<Date | null>(null)
  const isSyncing = ref(false)

  /**
   * Push tags from canvas node to Proxmox via vm_set_tag endpoint.
   * Only works for deployed VMs (with a vmId).
   */
  async function pushTags(node: string, vmId: number, tags: string[]): Promise<boolean> {
    if (!vmId || tags.length === 0) return false
    isSyncing.value = true
    try {
      await proxmoxApi.vm.setTags(node, vmId, tags)
      lastSyncTime.value = new Date()
      return true
    } catch (e) {
      console.warn('[tag-sync] Push failed:', e)
      return false
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Parse tags from WebSocket status data (semicolon-separated string).
   * Returns string[] suitable for node.data.tags.
   */
  function parseFromWebSocket(tagsStr: string): string[] {
    return parseTags(tagsStr)
  }

  return {
    lastSyncTime,
    isSyncing,
    pushTags,
    parseFromWebSocket,
  }
}

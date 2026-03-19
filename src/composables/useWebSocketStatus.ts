/**
 * WebSocket-based live VM status updates.
 *
 * Connects to the backend WebSocket endpoint and receives real-time
 * VM status changes. Updates canvas nodes reactively.
 */

import { ref, computed, onUnmounted, type Ref } from 'vue'
import { getBaseUrl } from '@/services/proxmox/api'

interface VmStatus {
  vmid: number
  name: string
  status: string
  cpu: number
  mem: number
  maxmem: number
  uptime: number
}

interface WsMessage {
  type: 'full' | 'diff'
  vms?: VmStatus[]
  changes?: Record<string, VmStatus & { type: 'added' | 'changed' | 'removed' }>
  error?: string
}

export function useWebSocketStatus() {
  const vmStatuses = ref<Map<number, VmStatus>>(new Map())
  const isConnected = ref(false)
  const error = ref<string | null>(null)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function getWsUrl(): string | null {
    const baseUrl = getBaseUrl()
    if (!baseUrl) return null

    // Read Proxmox connection details from localStorage
    const stored = JSON.parse(localStorage.getItem('range42_proxmox_settings') || '{}')
    const node = stored.defaultNode || 'pve01'

    // Read API token from inventory (stored in localStorage by import flow)
    // For now, hardcode the connection params — these should come from project settings
    const inventoryStr = localStorage.getItem('range42_ws_config')
    let apiHost = '', tokenId = '', tokenSecret = ''

    if (inventoryStr) {
      try {
        const inv = JSON.parse(inventoryStr)
        apiHost = inv.api_host || ''
        tokenId = inv.token_id || ''
        tokenSecret = inv.token_secret || ''
      } catch { /* ignore */ }
    }

    if (!apiHost || !tokenId || !tokenSecret) return null

    // Convert http(s) URL to ws(s)
    const wsBase = baseUrl.replace(/^http/, 'ws')
    return `${wsBase}/ws/vm-status?node=${node}&api_host=${encodeURIComponent(apiHost)}&token_id=${encodeURIComponent(tokenId)}&token_secret=${encodeURIComponent(tokenSecret)}`
  }

  function connect() {
    const url = getWsUrl()
    if (!url) {
      error.value = 'WebSocket config not set. Set range42_ws_config in localStorage.'
      return
    }

    try {
      ws = new WebSocket(url)

      ws.onopen = () => {
        isConnected.value = true
        error.value = null
        console.log('[ws] Connected to VM status stream')
      }

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data)

          if (msg.error) {
            error.value = msg.error
            return
          }

          if (msg.type === 'full' && msg.vms) {
            const newMap = new Map<number, VmStatus>()
            for (const vm of msg.vms) {
              newMap.set(vm.vmid, vm)
            }
            vmStatuses.value = newMap
          }

          if (msg.type === 'diff' && msg.changes) {
            const updated = new Map(vmStatuses.value)
            for (const [vmidStr, change] of Object.entries(msg.changes)) {
              const vmid = Number(vmidStr)
              if (change.type === 'removed') {
                updated.delete(vmid)
              } else {
                updated.set(vmid, change)
              }
            }
            vmStatuses.value = updated
          }
        } catch (e) {
          console.warn('[ws] Failed to parse message:', e)
        }
      }

      ws.onclose = () => {
        isConnected.value = false
        console.log('[ws] Disconnected, reconnecting in 5s...')
        reconnectTimer = setTimeout(connect, 5000)
      }

      ws.onerror = (e) => {
        error.value = 'WebSocket connection error'
        console.warn('[ws] Error:', e)
      }
    } catch (e) {
      error.value = `WebSocket failed: ${e}`
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onclose = null // prevent reconnect
      ws.close()
      ws = null
    }
    isConnected.value = false
  }

  function getVmStatus(vmid: number): VmStatus | undefined {
    return vmStatuses.value.get(vmid)
  }

  function isVmRunning(vmid: number): boolean {
    return vmStatuses.value.get(vmid)?.status === 'running'
  }

  onUnmounted(disconnect)

  return {
    vmStatuses,
    isConnected,
    error,
    connect,
    disconnect,
    getVmStatus,
    isVmRunning,
  }
}

export default useWebSocketStatus

/**
 * WebSocket-based live VM status updates.
 *
 * Connects to the backend WebSocket endpoint which handles all
 * Proxmox authentication server-side. Frontend only needs the backend URL.
 */

import { ref, onUnmounted } from 'vue'
import { getBaseUrl } from '@/services/proxmox/api'

interface VmStatus {
  vmid: number
  name: string
  status: string
  cpu: number       // 0-100 percentage
  mem: number       // bytes used
  maxmem: number    // bytes total
  uptime: number    // seconds
  tags: string      // semicolon-separated from Proxmox
}

export function useWebSocketStatus() {
  const vmStatuses = ref<Map<number, VmStatus>>(new Map())
  const isConnected = ref(false)
  const error = ref<string | null>(null)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect(node?: string) {
    const baseUrl = getBaseUrl()
    if (!baseUrl) {
      error.value = 'Backend API URL not configured'
      return
    }

    // Convert http(s) to ws(s)
    const wsBase = baseUrl.replace(/^http/, 'ws')
    const url = node
      ? `${wsBase}/ws/vm-status?node=${node}`
      : `${wsBase}/ws/vm-status`

    try {
      ws = new WebSocket(url)

      ws.onopen = () => {
        isConnected.value = true
        error.value = null
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)

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
              const c = change as VmStatus & { type: string }
              if (c.type === 'removed') {
                updated.delete(vmid)
              } else {
                updated.set(vmid, c)
              }
            }
            vmStatuses.value = updated
          }
        } catch (e) {
          console.warn('[ws] Parse error:', e)
        }
      }

      ws.onclose = () => {
        isConnected.value = false
        reconnectTimer = setTimeout(() => connect(node), 5000)
      }

      ws.onerror = () => {
        error.value = 'WebSocket error'
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
      ws.onclose = null
      ws.close()
      ws = null
    }
    isConnected.value = false
  }

  function getVmStatus(vmid: number): VmStatus | undefined {
    return vmStatuses.value.get(vmid)
  }

  onUnmounted(disconnect)

  return {
    vmStatuses,
    isConnected,
    error,
    connect,
    disconnect,
    getVmStatus,
  }
}

export default useWebSocketStatus

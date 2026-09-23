import { onScopeDispose, ref, watch } from 'vue'
import { captureBackendGuard, listRegisteredGuests, getGuestStatus } from '@/services/proxmox/api'
import type { ProxmoxTarget } from '@/services/proxmox/api'
import { useBackendApiStore } from '@/stores/backendApiStore'

export interface ObservedGuestNode {
  id: string
  type?: string
  data?: Record<string, unknown>
}
export interface ObservedGuestStatusOptions {
  nodes: () => ObservedGuestNode[]
  projectId: () => string | undefined
  enabled: () => boolean
  target: () => ProxmoxTarget
  apply: (node: ObservedGuestNode, patch: { status: string; statusError?: string }) => void
}

/** Read observations independently of authored settings, grouped by explicit host. */
export function useObservedGuestStatus(options: ObservedGuestStatusOptions) {
  const backend = useBackendApiStore()
  const error = ref<string | null>(null)
  const lastChecked = ref<number | null>(null)
  const isRefreshing = ref(false)
  let generation = 0, disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  function candidates() {
    return options.nodes().flatMap(node => {
      const data = node.data, vmid = Number(data?.vmId)
      if (!data?.deployed || data.pendingAction || !Number.isSafeInteger(vmid) || vmid < 1
        || (node.type !== 'vm' && node.type !== 'lxc')) return []
      const config = data.config && typeof data.config === 'object' ? data.config as Record<string, unknown> : {}
      const fallback = options.target()
      const target: ProxmoxTarget = {
        node: typeof config.proxmoxNode === 'string' && config.proxmoxNode ? config.proxmoxNode : fallback.node,
        ...(typeof config.proxmoxHostId === 'string' && config.proxmoxHostId ? { hostId: config.proxmoxHostId } : fallback.hostId ? { hostId: fallback.hostId } : {}),
      }
      const type = node.type === 'lxc' ? 'lxc' : 'qemu'
      return [{ node, vmid, type, target, key: JSON.stringify([node.id, vmid, type, target.node, target.hostId]) }]
    })
  }
  function clearTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  async function refresh() {
    if (disposed || !visible() || !options.enabled() || isRefreshing.value) return
    clearTimer()
    const version = generation, project = options.projectId(), entries = candidates()
    const current = () => !disposed && generation === version && visible() && options.enabled() && options.projectId() === project
    let checkBackend: () => void
    isRefreshing.value = true
    error.value = null
    try {
      checkBackend = captureBackendGuard()
      const groups = new Map<string, typeof entries>()
      for (const entry of entries) {
        const key = JSON.stringify(entry.target)
        groups.set(key, [...(groups.get(key) || []), entry])
      }
      for (const group of groups.values()) {
        if (!current()) return
        let guests: Awaited<ReturnType<typeof listRegisteredGuests>>['guests'] = []
        let message: string | undefined
        try {
          checkBackend()
          const result = await listRegisteredGuests(group[0].target)
          checkBackend()
          guests = result.guests
        } catch {
          if (!current()) return
          // Context changes cannot turn observations from the prior backend into errors on the new one.
          try { checkBackend() } catch { return }
          message = 'Guest status could not be read. Check backend access and refresh.'
        }
        if (!current()) return
        for (const entry of group) {
          const stillSelected = () => candidates().some(candidate => candidate.node === entry.node && candidate.key === entry.key)
          if (!current()) return
          if (!stillSelected()) continue
          const guest = guests.find(item => item.vmid === entry.vmid && item.type === entry.type)
          let status = guest?.status, problem = message
          if (!problem && guest?.type === 'qemu' && guest.status === 'running') {
            try {
              checkBackend()
              status = (await getGuestStatus(entry.vmid, 'qemu', entry.target)).status
              checkBackend()
            } catch {
              if (!current()) return
              try { checkBackend() } catch { return }
              problem = 'Guest run state could not be read. Refresh before taking action.'
            }
          }
          if (!current()) return
          if (!stillSelected()) continue
          problem ||= !guest || status === 'unknown' ? 'Guest status is unavailable on the selected host. Refresh its inventory before taking action.' : undefined
          options.apply(entry.node, { status: problem ? 'unknown' : status!, statusError: problem })
          if (problem) error.value = problem
        }
      }
      if (current()) lastChecked.value = Date.now()
    } catch {
      if (current()) error.value = 'Guest status could not be read. Check the selected backend.'
    } finally {
      if (generation === version) {
        isRefreshing.value = false
        if (!disposed && visible() && options.enabled()) timer = setTimeout(() => { void refresh() }, 15000)
      }
    }
  }
  function restart() {
    generation++
    clearTimer()
    isRefreshing.value = false
    error.value = null
    lastChecked.value = null
    void refresh()
  }
  // Observe identities only: status/metrics updates must not create a polling loop.
  watch(() => [options.projectId(), options.enabled(), JSON.stringify(options.target()),
    candidates().map(entry => entry.key).join('|'),
    backend.activeHost?.id, ...backend.hosts.map(host => JSON.stringify([host.id, host.url, host.token, host.nodeName])),
  ], restart, { immediate: true, flush: 'sync' })
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', restart)
  onScopeDispose(() => {
    disposed = true; generation++; clearTimer()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', restart)
  })
  return { refresh, error, lastChecked, isRefreshing }
}

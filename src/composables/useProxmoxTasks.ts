/**
 * useProxmoxTasks
 *
 * Task-tracking core for asynchronous Proxmox lifecycle actions. A "launch"
 * pushes a pending activity-log entry, marks the node transitional
 * (`data.pendingAction`, which drives the canvas transitional badge), invokes
 * the action's API call to obtain a UPID, then polls the task status to
 * completion. On success it reads the current guest status and invalidates
 * the VM cache; on failure or timeout it reverts the node and logs an error.
 */

import { captureBackendGuard, getTaskStatus, getGuestStatus } from '@/services/proxmox/api'
import type { ProxmoxTarget } from '@/services/proxmox/api'
import { proxmoxCache } from '@/services/proxmox/cache'
import { useActivityLogStore } from '@/stores/activityLogStore'
import { useToast } from '@/composables/useToast'

type TimeoutFn = (handler: () => void, ms: number) => unknown

export interface LaunchOptions {
  node: { id: string; type?: string; data: Record<string, unknown> }
  vmId: number | string
  vmtype: 'qemu' | 'lxc'
  target?: ProxmoxTarget
  apiCall: () => Promise<{ upid?: string }>
  onSuccess: () => void
}

export interface ProxmoxTasksOptions {
  setTimeoutFn?: TimeoutFn
  pollIntervalMs?: number
  maxPolls?: number
}

export function useProxmoxTasks(opts: ProxmoxTasksOptions = {}) {
  const log = useActivityLogStore()
  const { showToast } = useToast()
  const setTimeoutFn: TimeoutFn = opts.setTimeoutFn ?? ((h, ms) => setTimeout(h, ms))
  const pollIntervalMs = opts.pollIntervalMs ?? 1500
  const maxPolls = opts.maxPolls ?? 80 // ~120s at 1.5s

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeoutFn(() => resolve(), ms))
  }

  async function launch(action: string, o: LaunchOptions): Promise<void> {
    if (o.node.data.pendingAction) return // an action is already in flight for this node
    const identity = () => {
      const config = (o.node.data.config || {}) as Record<string, unknown>
      return JSON.stringify([o.node.id, o.node.type, o.node.data.vmId, config.proxmoxNode, config.proxmoxHostId])
    }
    const originalIdentity = identity(), originalData = o.node.data
    const sameGuest = () => o.node.data === originalData && identity() === originalIdentity
    const clearPending = () => { if (originalData.pendingAction === action) originalData.pendingAction = undefined }
    const config = (o.node.data.config || {}) as Record<string, unknown>
    const target: ProxmoxTarget = o.target || {
      ...(typeof config.proxmoxNode === 'string' ? { node: config.proxmoxNode } : {}),
      ...(typeof config.proxmoxHostId === 'string' ? { hostId: config.proxmoxHostId } : {}),
    }
    const prevStatus = o.node.data.status as string | undefined
    const entryId = log.push({
      source: 'proxmox',
      level: 'pending',
      target: (o.node.data.name as string) || String(o.vmId),
      message: `${action} requested`,
    })
    o.node.data.pendingAction = action

    let upid: string | undefined
    let checkBackend: () => void
    try {
      checkBackend = captureBackendGuard()
      const res = await o.apiCall()
      checkBackend()
      if (!sameGuest()) throw new Error('Guest selection changed. Refresh before continuing.')
      upid = res?.upid
      if (!upid) throw new Error('No task ID returned. Completion is unconfirmed; refresh the guest before retrying.')
    } catch (err) {
      o.node.data.pendingAction = undefined
      const msg = err instanceof Error ? err.message : String(err)
      log.update(entryId, { level: 'error', message: msg })
      showToast(msg, 'error')
      return
    }

    log.update(entryId, { upid })

    let settled = false
    for (let i = 0; i < maxPolls; i++) {
      await delay(pollIntervalMs)
      let ts
      try {
        checkBackend()
      } catch {
        clearPending()
        if (sameGuest()) revert(o, prevStatus)
        const message = 'Backend context changed. Task completion is unconfirmed; refresh the original backend.'
        log.update(entryId, { level: 'error', message })
        showToast(message, 'error')
        return
      }
      try {
        if (!sameGuest()) { clearPending(); return }
        ts = await getTaskStatus(upid, target)
        checkBackend()
        if (!sameGuest()) { clearPending(); return }
      } catch {
        continue
      }
      if (ts.status === 'stopped') {
        settled = true
        if (ts.exitstatus === 'OK') {
          await finishSuccess(action, o, entryId, target, checkBackend, sameGuest, clearPending)
        } else {
          if (sameGuest()) revert(o, prevStatus)
          const msg = ts.exitstatus || 'task failed'
          log.update(entryId, { level: 'error', message: msg })
          showToast(`${action} failed: ${msg}`, 'error')
        }
        break
      }
    }

    if (!settled) {
      if (sameGuest()) revert(o, prevStatus)
      log.update(entryId, { level: 'error', message: `${action} timed out` })
      showToast(`${action} timed out`, 'error')
    }
  }

  async function finishSuccess(action: string, o: LaunchOptions, entryId: string, target: ProxmoxTarget,
    checkBackend: () => void, sameGuest: () => boolean, clearPending: () => void): Promise<void> {
    proxmoxCache.invalidate()
    try {
      if (action !== 'delete') {
        const guest = await getGuestStatus(Number(o.vmId), o.vmtype, target)
        checkBackend()
        if (!sameGuest()) return
        if (!guest || guest.status === 'unknown') throw new Error('Guest status is unavailable after task completion.')
        o.node.data.status = guest.status
        o.node.data.statusError = undefined
      }
      checkBackend()
      if (!sameGuest()) return
      log.update(entryId, { level: 'success', message: action === 'delete' ? 'deleted from Proxmox' : `${action} completed; guest status refreshed` })
      o.onSuccess()
    } catch {
      if (!sameGuest()) return
      const message = 'Task completed, but guest status could not be confirmed. Refresh the original backend before another action.'
      o.node.data.status = 'unknown'
      o.node.data.statusError = message
      log.update(entryId, { level: 'error', message })
      showToast(message, 'error')
    } finally {
      clearPending()
    }
  }

  function revert(o: LaunchOptions, prevStatus: string | undefined): void {
    o.node.data.pendingAction = undefined
    o.node.data.status = prevStatus
  }

  return { launch }
}

export default useProxmoxTasks

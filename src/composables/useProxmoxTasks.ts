/**
 * useProxmoxTasks
 *
 * Task-tracking core for asynchronous Proxmox lifecycle actions. A "launch"
 * pushes a pending activity-log entry, marks the node transitional
 * (`data.pendingAction`, which drives the canvas transitional badge), invokes
 * the action's API call to obtain a UPID, then polls the task status to
 * completion. On success it writes the confirmed node status and invalidates
 * the VM cache; on failure or timeout it reverts the node and logs an error.
 */

import { getTaskStatus } from '@/services/proxmox/api'
import { proxmoxCache } from '@/services/proxmox/cache'
import { useActivityLogStore } from '@/stores/activityLogStore'
import { useToast } from '@/composables/useToast'

type TimeoutFn = (handler: () => void, ms: number) => unknown

export interface LaunchOptions {
  node: { id: string; type?: string; data: Record<string, unknown> }
  vmId: number | string
  vmtype: 'qemu' | 'lxc'
  apiCall: () => Promise<{ upid?: string }>
  onSuccess: () => void
}

export interface ProxmoxTasksOptions {
  setTimeoutFn?: TimeoutFn
  pollIntervalMs?: number
  maxPolls?: number
}

const CONFIRMED_STATUS: Record<string, string> = {
  start: 'running',
  resume: 'running',
  restart: 'running',
  stop: 'stopped',
  'force-stop': 'stopped',
  pause: 'paused',
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
    const prevStatus = o.node.data.status as string | undefined
    const entryId = log.push({
      source: 'proxmox',
      level: 'pending',
      target: (o.node.data.name as string) || String(o.vmId),
      message: `${action} requested`,
    })
    o.node.data.pendingAction = action

    let upid: string | undefined
    try {
      const res = await o.apiCall()
      upid = res?.upid
    } catch (err) {
      o.node.data.pendingAction = undefined
      const msg = err instanceof Error ? err.message : String(err)
      log.update(entryId, { level: 'error', message: msg })
      showToast(msg, 'error')
      return
    }

    if (!upid) {
      finishSuccess(action, o, entryId)
      return
    }
    log.update(entryId, { upid })

    let settled = false
    for (let i = 0; i < maxPolls; i++) {
      await delay(pollIntervalMs)
      let ts
      try {
        ts = await getTaskStatus(upid)
      } catch {
        continue
      }
      if (ts.status === 'stopped') {
        settled = true
        if (ts.exitstatus === 'OK') {
          finishSuccess(action, o, entryId)
        } else {
          revert(o, prevStatus)
          const msg = ts.exitstatus || 'task failed'
          log.update(entryId, { level: 'error', message: msg })
          showToast(`${action} failed: ${msg}`, 'error')
        }
        break
      }
    }

    if (!settled) {
      revert(o, prevStatus)
      log.update(entryId, { level: 'error', message: `${action} timed out` })
      showToast(`${action} timed out`, 'error')
    }
  }

  function finishSuccess(action: string, o: LaunchOptions, entryId: string): void {
    o.node.data.pendingAction = undefined
    if (action === 'delete') {
      log.update(entryId, { level: 'success', message: 'deleted from Proxmox' })
    } else {
      const confirmed = CONFIRMED_STATUS[action]
      if (confirmed) o.node.data.status = confirmed
      log.update(entryId, { level: 'success', message: `${action} confirmed` })
    }
    o.onSuccess()
    proxmoxCache.invalidate()
  }

  function revert(o: LaunchOptions, prevStatus: string | undefined): void {
    o.node.data.pendingAction = undefined
    o.node.data.status = prevStatus
  }

  return { launch }
}

export default useProxmoxTasks

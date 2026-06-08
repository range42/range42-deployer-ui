/**
 * Activity Log Store
 *
 * Session-only, unified activity feed shared across the app. Aggregates
 * short, human-readable activity entries (e.g. Proxmox lifecycle actions and
 * live deployment events) into a single capped ring buffer. Not persisted —
 * cleared on reload, mirroring deploymentStore's session-only semantics.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ActivitySource = 'proxmox' | 'deploy'
export type ActivityLevel = 'pending' | 'success' | 'error' | 'info'

export interface ActivityEntry {
  id: string
  ts: number
  source: ActivitySource
  level: ActivityLevel
  target: string
  message: string
  upid?: string
}

const RING_CAP = 500
let _seq = 0

export const useActivityLogStore = defineStore('activityLog', () => {
  const entries = ref<ActivityEntry[]>([])

  function push(entry: Omit<ActivityEntry, 'id' | 'ts'>): string {
    const id = `a${++_seq}`
    entries.value.push({ ...entry, id, ts: Date.now() })
    if (entries.value.length > RING_CAP) {
      entries.value.splice(0, entries.value.length - RING_CAP)
    }
    return id
  }

  function update(id: string, patch: Partial<Omit<ActivityEntry, 'id'>>): void {
    const e = entries.value.find((x) => x.id === id)
    if (e) Object.assign(e, patch)
  }

  function clear(): void {
    entries.value = []
  }

  return { entries, push, update, clear }
})

export default useActivityLogStore

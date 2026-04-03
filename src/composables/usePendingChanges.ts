import { computed, type Ref } from 'vue'
import { getChangeCategory, getChangeLabel } from '@/constants/changeCategories'
import type { PendingChange } from '@/services/proxmox/types'

const DIFFABLE_FIELDS = ['name', 'cores', 'memory', 'tags']

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

function fieldsEqual(desired: unknown, actual: unknown): boolean {
  if (Array.isArray(desired) && Array.isArray(actual)) {
    return arraysEqual(desired, actual)
  }
  return desired === actual
}

export function usePendingChanges(nodeData: Ref<Record<string, unknown>>) {
  const pendingChanges = computed<PendingChange[]>(() => {
    if (!nodeData.value?.deployed) return []
    const desired = nodeData.value.desiredConfig as Record<string, unknown> | undefined
    const actual = nodeData.value.actualConfig as Record<string, unknown> | undefined
    if (!desired || !actual) return []

    const changes: PendingChange[] = []
    for (const field of DIFFABLE_FIELDS) {
      const d = desired[field]
      const a = actual[field]
      if (d === undefined && a === undefined) continue
      if (d === undefined || a === undefined || !fieldsEqual(d, a)) {
        changes.push({
          field,
          label: getChangeLabel(field),
          desired: d,
          actual: a,
          category: getChangeCategory(field),
        })
      }
    }
    return changes
  })

  const hasPendingChanges = computed(() => pendingChanges.value.length > 0)
  const pendingCount = computed(() => pendingChanges.value.length)

  const liveChanges = computed(() => pendingChanges.value.filter(c => c.category === 'live'))
  const restartChanges = computed(() => pendingChanges.value.filter(c => c.category === 'restart'))
  const redeployChanges = computed(() => pendingChanges.value.filter(c => c.category === 'redeploy'))

  function revertField(field: string): void {
    const desired = nodeData.value.desiredConfig as Record<string, unknown>
    const actual = nodeData.value.actualConfig as Record<string, unknown>
    if (!desired || !actual) return
    if (Array.isArray(actual[field])) {
      desired[field] = [...(actual[field] as unknown[])]
    } else {
      desired[field] = actual[field]
    }
  }

  function revertAll(): void {
    const actual = nodeData.value.actualConfig as Record<string, unknown>
    const desired = nodeData.value.desiredConfig as Record<string, unknown>
    if (!actual) return
    const reverted: Record<string, unknown> = {}
    for (const field of DIFFABLE_FIELDS) {
      // Use actual value; fall back to current desired to avoid dropping fields
      // that the WebSocket doesn't provide (e.g. cores, memory, description)
      const source = actual[field] !== undefined ? actual : desired
      if (source && source[field] !== undefined) {
        reverted[field] = Array.isArray(source[field])
          ? [...(source[field] as unknown[])]
          : source[field]
      }
    }
    nodeData.value.desiredConfig = reverted
  }

  function updateDesired(field: string, value: unknown): void {
    const desired = nodeData.value.desiredConfig as Record<string, unknown>
    if (!desired) return
    desired[field] = value
  }

  return {
    pendingChanges,
    hasPendingChanges,
    pendingCount,
    liveChanges,
    restartChanges,
    redeployChanges,
    revertField,
    revertAll,
    updateDesired,
  }
}

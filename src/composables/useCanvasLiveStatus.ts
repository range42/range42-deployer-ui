/**
 * useCanvasLiveStatus — Plan C §C4.7
 *
 * Bridges the deploymentStore SSE record to the canvas node status colours.
 *
 * Colour map (spec-aligned):
 *   default         → gray
 *   task_start      → blue  (deploying)
 *   task_end ok     → green (running)
 *   task_end failed → red   (error)
 *   host_unreachable→ orange (warn)
 *
 * The function `mapStatusFromEvent` is pure and unit-testable. The composable
 * `useCanvasLiveStatus` wires the store record to a reactive map that views
 * can merge into VueFlow node `data.status`.
 */

import { computed, watch, ref, type Ref } from 'vue'
import type { DeploymentRecord, SseEvent } from '@/stores/deploymentStore'

export type CanvasNodeStatus =
  | 'gray'     // default / pending
  | 'blue'     // deploying
  | 'green'    // running / ok
  | 'red'      // error
  | 'orange'   // warn

export interface NodeIdent {
  node_id?: string
  host?: string
  vm_id?: number | string
}

/**
 * Decide the next node status given the current status and an SSE event's
 * payload-level hint. Returns undefined when the event does not map.
 */
export function mapStatusFromEvent(
  event: SseEvent,
  current: CanvasNodeStatus = 'gray',
): CanvasNodeStatus | undefined {
  const payload = (event.payload || {}) as Record<string, unknown>
  switch (event.event_type) {
    case 'task_start':
      return 'blue'
    case 'task_end': {
      const result = String(payload.result || '')
      if (result === 'failed') return 'red'
      if (result === 'ok' || result === 'changed') return 'green'
      return current
    }
    case 'host_unreachable':
      return 'orange'
    default:
      return undefined
  }
}

/**
 * Resolve an identity for the canvas node attached to an event. Callers
 * provide a lookup that turns host/node_id/vm_id into a canvas node id.
 */
export function resolveNodeId(
  event: SseEvent,
  lookup: (ident: NodeIdent) => string | null,
): string | null {
  const payload = (event.payload || {}) as Record<string, unknown>
  return lookup({
    node_id: payload.node_id as string | undefined,
    host: payload.host as string | undefined,
    vm_id: payload.vm_id as number | string | undefined,
  })
}

/**
 * Composable — returns a Map<nodeId, CanvasNodeStatus> kept in sync with the
 * live deployment record. The map only contains nodes touched by events so
 * callers can overlay it without clobbering existing status.
 */
export function useCanvasLiveStatus(
  record: Ref<DeploymentRecord | null>,
  resolveNode: (ident: NodeIdent) => string | null,
) {
  const statuses = ref<Map<string, CanvasNodeStatus>>(new Map())
  const lastProcessedSeq = ref(0)

  // Precomputed applier used by both the watcher and direct test feed.
  function applyEvent(event: SseEvent) {
    const nodeId = resolveNodeId(event, resolveNode)
    if (!nodeId) return
    const current = statuses.value.get(nodeId) || 'gray'
    const next = mapStatusFromEvent(event, current)
    if (!next) return
    if (next !== current) {
      const copy = new Map(statuses.value)
      copy.set(nodeId, next)
      statuses.value = copy
    }
  }

  // Rebuild the map when we see a new record seq — process any replay events
  // carried in the teams slice. The store already applied events; here we
  // derive per-node statuses from the observable rollup (task_name/last task).
  watch(
    () => record.value?.last_event_seq,
    (seq) => {
      if (typeof seq !== 'number' || seq <= lastProcessedSeq.value) return
      lastProcessedSeq.value = seq
      const rec = record.value
      if (!rec) return
      // For teams we can synthesise colour from the team.status field.
      const next = new Map(statuses.value)
      for (const [teamId, slice] of Object.entries(rec.teams || {})) {
        const nodeId = resolveNode({ node_id: teamId })
        if (!nodeId) continue
        const mapped = statusForTeam(slice.status)
        if (mapped) next.set(nodeId, mapped)
      }
      statuses.value = next
    },
  )

  const statusOf = computed(() => (nodeId: string) => statuses.value.get(nodeId))

  return {
    statuses,
    applyEvent,
    statusOf,
  }
}

function statusForTeam(
  status: string | undefined,
): CanvasNodeStatus | undefined {
  switch (status) {
    case 'deploying':
      return 'blue'
    case 'deployed':
      return 'green'
    case 'failed':
      return 'red'
    case 'partial':
      return 'orange'
    default:
      return undefined
  }
}

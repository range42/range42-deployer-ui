/**
 * Deployment → Activity bridge
 *
 * Forwards raw deploymentStore SSE events (spec §18.2 vocabulary) into the
 * unified, session-only activity log. Registers a deploymentStore.onEvent
 * observer on setup and tears it down on unmount.
 */

import { onUnmounted } from 'vue'
import { useDeploymentStore } from '@/stores/deploymentStore'
import { useActivityLogStore, type ActivityLevel } from '@/stores/activityLogStore'

/** Mirrors the SseEvent shape from deploymentStore, but total/defensive. */
type SseEventLike =
  | {
      event_type?: string
      payload?: Record<string, unknown>
    }
  | undefined

/**
 * Map an SSE event onto an activity level. Failure-type events → 'error',
 * completion-type events → 'success', everything else → 'info'.
 */
function levelFor(event: SseEventLike): ActivityLevel {
  if (!event) return 'info'
  const type = event.event_type
  const payload = event.payload ?? {}

  if (type === 'host_unreachable') return 'error'
  if (type === 'task_end' && payload.result === 'failed') return 'error'
  if (type === 'attempt_end') {
    return payload.terminal_state === 'failed' ? 'error' : 'success'
  }
  if (type === 'state_transition' && payload.to === 'failed') return 'error'
  if (type === 'state_transition' && payload.to === 'deployed') return 'success'
  return 'info'
}

/** Pick the most human-readable message field available on the event. */
function messageFor(event: SseEventLike): string {
  if (!event) return ''
  const p = event.payload ?? {}
  const candidates = [p.text, p.task_name, p.detail, p.host, p.to, p.check]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c
  }
  return event.event_type ?? 'event'
}

/** Forwards deploymentStore SSE events into the unified activity log. */
export function useDeploymentActivityBridge() {
  const deployment = useDeploymentStore()
  const log = useActivityLogStore()

  const off = deployment.onEvent((deploymentId, raw) => {
    const event = raw as SseEventLike
    log.push({
      source: 'deploy',
      level: levelFor(event),
      target: deploymentId,
      message: messageFor(event),
    })
  })

  onUnmounted(off)
  return { off }
}

export default useDeploymentActivityBridge

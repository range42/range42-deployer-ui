/**
 * Deployment Store
 *
 * Tracks backend-owned deployment state and real-time progress.
 *
 * Also (Plan C §C4.1) consumes the backend SSE stream at
 *   `GET /v1/deployments/:id/events?from_cursor=<k>`
 * and dispatches the 12 event types defined in spec §18.2 into reactive
 * per-deployment slices (state machine, phase, per-team log ring buffers,
 * redaction counters, preflight rollup).
 */

import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import { BackendEventStream } from '@/services/backendEventStream'
import { getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from './backendApiStore'

// =============================================================================
// SSE event vocabulary — spec §18.2
// =============================================================================

export type SseEventType =
  | 'state_transition'
  | 'phase_transition'
  | 'task_start'
  | 'task_end'
  | 'host_unreachable'
  | 'log_line'
  | 'redaction'
  | 'heartbeat'
  | 'attempt_start'
  | 'attempt_end'
  | 'proxmox_task'
  | 'preflight_check'

export interface SseEvent {
  event_type: SseEventType
  event_seq: number
  attempt_id?: string
  ts?: string
  payload?: Record<string, unknown>
}

export interface LogLine {
  ts: string
  stream: 'stdout' | 'stderr'
  text: string
  team_id?: string
  host?: string
  ansible_event?: string
  task_action?: string
}

export interface TeamSlice {
  latest_logs: LogLine[] // ring buffer, max 200
  status: 'pending' | 'deploying' | 'deployed' | 'failed' | 'partial' | 'unknown'
  last_task?: string
  unreachable_hosts: string[]
}

export interface PreflightCheckResult {
  check: string
  result: 'pass' | 'warn' | 'block'
  detail?: string
}

export interface DeploymentRecord {
  id: string
  state: string // state-machine label (draft|preflight|deploying|deployed|failed|...)
  phase?: string
  attempt_id?: string
  last_event_seq: number
  logs: LogLine[] // shared (non-team) ring buffer, max 200
  teams: Record<string, TeamSlice>
  redaction_counters: Record<string, number> // by rule_id
  preflight_checks: PreflightCheckResult[]
  proxmox_tasks: Array<{ task_uuid: string; kind: string; vm_id?: number; node: string }>
  last_heartbeat_at?: string
  connection: 'idle' | 'connecting' | 'open' | 'retrying' | 'closed' | 'exhausted'
  retry_count: number
}

export interface SubscribeOptions {
  from_cursor?: number
  baseUrl?: string
  /** Override EventSource constructor (used by tests). */
  eventSourceCtor?: typeof EventSource
  /** Override setTimeout (used by tests). */
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  /** Override clearTimeout (used by tests). */
  clearTimeoutFn?: (h: ReturnType<typeof setTimeout>) => void
}

// -----------------------------------------------------------------------------
// Reconnect policy — bounded backoff, bounded retries.
// -----------------------------------------------------------------------------

export const SSE_MAX_RETRIES = 6
export const SSE_BACKOFF_BASE_MS = 1000
export const SSE_BACKOFF_MAX_MS = 30_000
export const LOG_RING_CAPACITY = 200

export function computeBackoff(retry: number): number {
  const exp = Math.min(SSE_BACKOFF_MAX_MS, SSE_BACKOFF_BASE_MS * 2 ** retry)
  return exp
}

/** Push a log line into a ring buffer in-place, capped at LOG_RING_CAPACITY. */
export function pushRing(buffer: LogLine[], line: LogLine, cap = LOG_RING_CAPACITY): void {
  buffer.push(line)
  if (buffer.length > cap) buffer.splice(0, buffer.length - cap)
}

function ensureTeam(record: DeploymentRecord, teamId: string | undefined): TeamSlice | null {
  if (!teamId) return null
  if (!record.teams[teamId]) {
    record.teams[teamId] = {
      latest_logs: [],
      status: 'pending',
      unreachable_hosts: [],
    }
  }
  return record.teams[teamId]
}

/**
 * Dispatch one SSE event into a DeploymentRecord. Pure function — no I/O —
 * so it can be unit-tested directly.
 */
export function applySseEvent(record: DeploymentRecord, event: SseEvent): void {
  if (typeof event.event_seq === 'number' && event.event_seq > record.last_event_seq) {
    record.last_event_seq = event.event_seq
  }
  if (event.attempt_id) record.attempt_id = event.attempt_id

  const payload = (event.payload ?? {}) as Record<string, unknown>
  const ts = event.ts || new Date().toISOString()

  switch (event.event_type) {
    case 'state_transition': {
      const to = payload.to
      if (typeof to === 'string') record.state = to
      break
    }
    case 'phase_transition': {
      const to = payload.to
      if (typeof to === 'string') record.phase = to
      break
    }
    case 'task_start': {
      const team = ensureTeam(record, payload.team_id as string | undefined)
      const taskName = typeof payload.task_name === 'string' ? payload.task_name : undefined
      if (team) {
        team.last_task = taskName
        team.status = 'deploying'
      }
      break
    }
    case 'task_end': {
      const team = ensureTeam(record, payload.team_id as string | undefined)
      const result = payload.result as string | undefined
      if (team) {
        if (result === 'failed') team.status = 'failed'
        else if (result === 'ok' || result === 'changed') {
          team.status = team.status === 'failed' ? 'partial' : team.status
        }
      }
      break
    }
    case 'host_unreachable': {
      const host = payload.host as string | undefined
      const team = ensureTeam(record, payload.team_id as string | undefined)
      if (host) {
        if (team) {
          if (!team.unreachable_hosts.includes(host)) team.unreachable_hosts.push(host)
        }
      }
      break
    }
    case 'log_line': {
      const line: LogLine = {
        ts,
        stream: (payload.stream as 'stdout' | 'stderr') || 'stdout',
        text: typeof payload.text === 'string' ? payload.text : '',
        team_id: payload.team_id as string | undefined,
        host: payload.host as string | undefined,
        ansible_event: payload.ansible_event as string | undefined,
        task_action: payload.task_action as string | undefined,
      }
      if (line.team_id) {
        const team = ensureTeam(record, line.team_id)
        if (team) pushRing(team.latest_logs, line)
      } else {
        pushRing(record.logs, line)
      }
      break
    }
    case 'redaction': {
      const ruleId = (payload.rule_id as string) || 'unknown'
      record.redaction_counters[ruleId] = (record.redaction_counters[ruleId] || 0) + 1
      break
    }
    case 'heartbeat': {
      record.last_heartbeat_at = ts
      break
    }
    case 'attempt_start': {
      const attemptId = payload.attempt_id as string | undefined
      if (attemptId) record.attempt_id = attemptId
      break
    }
    case 'attempt_end': {
      const terminal = payload.terminal_state as string | undefined
      if (typeof terminal === 'string') record.state = terminal
      break
    }
    case 'proxmox_task': {
      const taskUuid = payload.task_uuid as string | undefined
      const kind = (payload.kind as string) || 'unknown'
      const node = (payload.node as string) || ''
      if (taskUuid) {
        record.proxmox_tasks.push({
          task_uuid: taskUuid,
          kind,
          vm_id: payload.vm_id as number | undefined,
          node,
        })
      }
      break
    }
    case 'preflight_check': {
      const check = payload.check as string | undefined
      const result = payload.result as 'pass' | 'warn' | 'block' | undefined
      if (check && result) {
        record.preflight_checks.push({
          check,
          result,
          detail: payload.detail as string | undefined,
        })
      }
      break
    }
    default: {
      // Unknown event_type — ignored on purpose (forward-compat).
      break
    }
  }
}

function makeEmptyRecord(id: string): DeploymentRecord {
  return {
    id,
    state: 'unknown',
    phase: undefined,
    attempt_id: undefined,
    last_event_seq: 0,
    logs: [],
    teams: {},
    redaction_counters: {},
    preflight_checks: [],
    proxmox_tasks: [],
    connection: 'idle',
    retry_count: 0,
  }
}

// =============================================================================
// Store
// =============================================================================

export const useDeploymentStore = defineStore('deployment', () => {
  // Plan C §C4.1 — SSE-backed live deployment records.
  const deployments = reactive<Record<string, DeploymentRecord>>({})
  const activeStreams = new Map<string, EventSource | BackendEventStream>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const subscribeOpts = new Map<string, SubscribeOptions>()

  // Observer registry — notified IN ADDITION TO applySseEvent (after it) so
  // external consumers (e.g. the activity-log bridge) can react to raw events
  // without polluting the pure applySseEvent dispatcher.
  const _eventObservers = new Set<(deploymentId: string, event: unknown) => void>()

  function onEvent(cb: (deploymentId: string, event: unknown) => void): () => void {
    _eventObservers.add(cb)
    return () => _eventObservers.delete(cb)
  }

  function getOrCreateRecord(id: string): DeploymentRecord {
    if (!deployments[id]) {
      deployments[id] = makeEmptyRecord(id)
    }
    return deployments[id]
  }

  /**
   * Open an EventSource against the deployment events stream. Returns the
   * EventSource instance (or null if already open). Auto-reconnects with
   * exponential backoff up to SSE_MAX_RETRIES, passing `from_cursor` =
   * last seen `event_seq` so the server can replay missed events.
   */
  function subscribe(id: string, opts: SubscribeOptions = {}): EventSource | BackendEventStream | null {
    if (activeStreams.has(id)) return activeStreams.get(id) || null
    subscribeOpts.set(id, opts)
    const record = getOrCreateRecord(id)
    if (opts.from_cursor && opts.from_cursor > record.last_event_seq) {
      record.last_event_seq = opts.from_cursor
    }
    return openStream(id)
  }

  function openStream(id: string): EventSource | BackendEventStream | null {
    const opts = subscribeOpts.get(id) || {}
    const record = getOrCreateRecord(id)
    const Ctor = opts.eventSourceCtor
      || (typeof EventSource !== 'undefined' ? EventSource : undefined)
    const backend = useBackendApiStore()
    const base = opts.baseUrl ?? getBackendScope()
    const headers = base === getBackendScope() ? backend.authHeaders() : {}
    const useFetch = !opts.eventSourceCtor && !!headers.Authorization
    if (!Ctor && !useFetch) {
      record.connection = 'exhausted'
      return null
    }
    const cursor = record.last_event_seq || 0
    const url = `${base}/v1/deployments/${encodeURIComponent(id)}/events?from_cursor=${cursor}`
    record.connection = 'connecting'
    let es: EventSource | BackendEventStream
    try {
      es = useFetch ? new BackendEventStream(url, headers) : new Ctor!(url)
    } catch (err) {
      console.warn('[deploymentStore] EventSource ctor failed:', err)
      record.connection = 'exhausted'
      return null
    }
    activeStreams.set(id, es)

    es.onopen = () => {
      record.connection = 'open'
      record.retry_count = 0
    }
    es.onmessage = (evt: MessageEvent) => {
      if (activeStreams.get(id) !== es) return
      let parsed: SseEvent | null = null
      try {
        parsed = JSON.parse(evt.data) as SseEvent
      } catch {
        return
      }
      if (parsed) {
        applySseEvent(record, parsed)
        _eventObservers.forEach((cb) => {
          try {
            cb(id, parsed)
          } catch (err) {
            console.warn('[deploymentStore] activity observer threw:', err)
          }
        })
      }
    }
    if ('addEventListener' in es) {
      for (const type of [
        'state_transition', 'phase_transition', 'task_start', 'task_end',
        'host_unreachable', 'log_line', 'redaction', 'heartbeat',
        'attempt_start', 'attempt_end', 'proxmox_task', 'preflight_check',
      ]) {
        es.addEventListener(type, es.onmessage as EventListener)
      }
    }
    es.onerror = () => {
      if (activeStreams.get(id) === es) scheduleReconnect(id)
    }
    return es
  }

  function scheduleReconnect(id: string) {
    const record = getOrCreateRecord(id)
    const opts = subscribeOpts.get(id) || {}
    const setTimeoutImpl = opts.setTimeoutFn || setTimeout
    const existing = activeStreams.get(id)
    if (existing) {
      try { existing.close() } catch { /* ignore */ }
      activeStreams.delete(id)
    }
    if (record.retry_count >= SSE_MAX_RETRIES) {
      record.connection = 'exhausted'
      return
    }
    record.retry_count += 1
    record.connection = 'retrying'
    const delay = computeBackoff(record.retry_count - 1)
    const h = setTimeoutImpl(() => {
      retryTimers.delete(id)
      if (!subscribeOpts.has(id)) return // unsubscribed meanwhile
      openStream(id)
    }, delay)
    retryTimers.set(id, h)
  }

  function unsubscribe(id: string) {
    const opts = subscribeOpts.get(id) || {}
    const clearTimeoutImpl = opts.clearTimeoutFn || clearTimeout
    const es = activeStreams.get(id)
    if (es) {
      try { es.close() } catch { /* ignore */ }
      activeStreams.delete(id)
    }
    const timer = retryTimers.get(id)
    if (timer) {
      clearTimeoutImpl(timer)
      retryTimers.delete(id)
    }
    subscribeOpts.delete(id)
    const record = deployments[id]
    if (record) record.connection = 'closed'
  }

  const backend = useBackendApiStore()
  watch([getBackendScope, () => backend.token], () => {
    for (const id of subscribeOpts.keys()) unsubscribe(id)
    for (const id of Object.keys(deployments)) delete deployments[id]
  }, { flush: 'sync' })

  return {
    // SSE (§C4.1)
    deployments,
    subscribe,
    unsubscribe,
    getOrCreateRecord,
    onEvent,
  }
})

export default useDeploymentStore

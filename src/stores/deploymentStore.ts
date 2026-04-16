/**
 * Deployment Store
 *
 * Manages deployment state, executes deployment plans step by step,
 * and tracks progress. Provides real-time status updates.
 *
 * Also (Plan C §C4.1) consumes the backend SSE stream at
 *   `GET /v1/deployments/:id/events?from_cursor=<k>`
 * and dispatches the 12 event types defined in spec §18.2 into reactive
 * per-deployment slices (state machine, phase, per-team log ring buffers,
 * redaction counters, preflight rollup).
 */

import { ref, computed, reactive } from 'vue'
import { defineStore } from 'pinia'
import {
  proxmoxApi,
  type DeploymentPlan,
  type DeploymentStep,
} from '@/services/proxmox'
import { useProjectStore } from './projectStore'

// =============================================================================
// Types
// =============================================================================

export interface DeploymentLog {
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  stepId?: string
}

export interface DeploymentState {
  currentPlan: DeploymentPlan | null
  isDeploying: boolean
  isPaused: boolean
  logs: DeploymentLog[]
  startTime: string | null
  endTime: string | null
}

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
  // State
  const currentPlan = ref<DeploymentPlan | null>(null)
  const isDeploying = ref(false)
  const isPaused = ref(false)
  const logs = ref<DeploymentLog[]>([])
  const startTime = ref<string | null>(null)
  const endTime = ref<string | null>(null)

  // Plan C §C4.1 — SSE-backed live deployment records.
  const deployments = reactive<Record<string, DeploymentRecord>>({})
  const activeStreams = new Map<string, EventSource>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const subscribeOpts = new Map<string, SubscribeOptions>()

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
  function subscribe(id: string, opts: SubscribeOptions = {}): EventSource | null {
    if (activeStreams.has(id)) return activeStreams.get(id) || null
    subscribeOpts.set(id, opts)
    const record = getOrCreateRecord(id)
    if (opts.from_cursor && opts.from_cursor > record.last_event_seq) {
      record.last_event_seq = opts.from_cursor
    }
    return openStream(id)
  }

  function openStream(id: string): EventSource | null {
    const opts = subscribeOpts.get(id) || {}
    const record = getOrCreateRecord(id)
    const Ctor = opts.eventSourceCtor
      || (typeof EventSource !== 'undefined' ? EventSource : undefined)
    if (!Ctor) {
      record.connection = 'exhausted'
      return null
    }
    const base = opts.baseUrl || ''
    const cursor = record.last_event_seq || 0
    const url = `${base}/v1/deployments/${encodeURIComponent(id)}/events?from_cursor=${cursor}`
    record.connection = 'connecting'
    let es: EventSource
    try {
      es = new Ctor(url)
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
      let parsed: SseEvent | null = null
      try {
        parsed = JSON.parse(evt.data) as SseEvent
      } catch {
        return
      }
      if (parsed) applySseEvent(record, parsed)
    }
    es.onerror = () => scheduleReconnect(id)
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

  // Abort controller for cancellation
  let abortController: AbortController | null = null

  // =============================================================================
  // Node Status Integration
  // =============================================================================

  /**
   * Update canvas node status based on deployment step result
   * Maps deployment status to node status colors
   */
  function updateNodeStatus(
    nodeId: string,
    status: 'pending' | 'deploying' | 'running' | 'stopped' | 'error'
  ): void {
    if (!currentPlan.value?.projectId) return

    const projectStore = useProjectStore()
    projectStore.updateNodeStatus(currentPlan.value.projectId, nodeId, status)
  }

  function markNodeDeployed(nodeId: string, payload: Record<string, unknown>): void {
    if (!currentPlan.value?.projectId) return

    const projectStore = useProjectStore()
    const project = projectStore.getProject(currentPlan.value.projectId)
    if (!project) return

    const node = project.nodes.find((n: any) => n.id === nodeId)
    if (!node?.data) return

    node.data.deployed = true
    node.data.vmId = payload.vm_id ? Number(payload.vm_id) : undefined
    projectStore.updateProject(currentPlan.value.projectId, { nodes: project.nodes })
  }

  // =============================================================================
  // Computed
  // =============================================================================

  const progress = computed(() => {
    if (!currentPlan.value) return 0
    const steps = currentPlan.value.steps
    const completed = steps.filter(s => s.status === 'completed').length
    return Math.round((completed / steps.length) * 100)
  })

  const currentStep = computed(() => {
    if (!currentPlan.value) return null
    return currentPlan.value.steps.find(s => s.status === 'running') || null
  })

  const completedSteps = computed(() => {
    if (!currentPlan.value) return []
    return currentPlan.value.steps.filter(s => s.status === 'completed')
  })

  const failedSteps = computed(() => {
    if (!currentPlan.value) return []
    return currentPlan.value.steps.filter(s => s.status === 'failed')
  })

  const pendingSteps = computed(() => {
    if (!currentPlan.value) return []
    return currentPlan.value.steps.filter(s => s.status === 'pending')
  })

  // =============================================================================
  // Logging
  // =============================================================================

  function addLog(
    level: DeploymentLog['level'],
    message: string,
    stepId?: string
  ) {
    logs.value.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      stepId,
    })
  }

  function clearLogs() {
    logs.value = []
  }

  // =============================================================================
  // Step Execution
  // =============================================================================

  async function executeStep(step: DeploymentStep): Promise<boolean> {
    step.status = 'running'
    step.startedAt = new Date().toISOString()
    addLog('info', `Starting: ${step.name}`, step.id)

    // Update node status to 'deploying'
    updateNodeStatus(step.nodeId, 'deploying')

    try {
      // Execute based on step type
      switch (step.type) {
        case 'noop': {
          // Already deployed — nothing to do
          break
        }

        case 'create_bridge': {
          await proxmoxApi.network.addToNode(step.payload as Parameters<typeof proxmoxApi.network.addToNode>[0])
          break
        }

        case 'create_vm': {
          await proxmoxApi.vm.create(step.payload as Parameters<typeof proxmoxApi.vm.create>[0])
          break
        }

        case 'clone_template': {
          await proxmoxApi.vm.clone(step.payload as Parameters<typeof proxmoxApi.vm.clone>[0])
          break
        }

        case 'create_lxc': {
          await proxmoxApi.lxc.create(step.payload as Parameters<typeof proxmoxApi.lxc.create>[0])
          break
        }

        case 'configure_network': {
          await proxmoxApi.network.addToVm(step.payload as Parameters<typeof proxmoxApi.network.addToVm>[0])
          break
        }

        case 'add_firewall_rule': {
          await proxmoxApi.firewall.addRule(step.payload as Parameters<typeof proxmoxApi.firewall.addRule>[0])
          break
        }

        case 'start_vm': {
          const payload = step.payload as { proxmox_node: string; vm_id: number }
          await proxmoxApi.vm.start({
            proxmox_node: payload.proxmox_node,
            vm_id: payload.vm_id,
          })
          break
        }

        case 'start_lxc': {
          const payload = step.payload as { proxmox_node: string; vm_id: number }
          await proxmoxApi.lxc.start(payload.proxmox_node, payload.vm_id)
          break
        }

        default:
          addLog('warning', `Unknown step type: ${step.type}`, step.id)
      }

      step.status = 'completed'
      step.completedAt = new Date().toISOString()
      addLog('success', `Completed: ${step.name}`, step.id)
      
      // Update node status based on step type
      if (['start_vm', 'start_lxc'].includes(step.type)) {
        // VM is now running — mark as deployed with VMID
        updateNodeStatus(step.nodeId, 'running')
        markNodeDeployed(step.nodeId, step.payload)
      } else if (step.type === 'noop') {
        // Already deployed — no status change needed
      } else {
        updateNodeStatus(step.nodeId, 'stopped')
      }
      
      return true

    } catch (error) {
      step.status = 'failed'
      step.completedAt = new Date().toISOString()
      step.error = error instanceof Error ? error.message : String(error)
      addLog('error', `Failed: ${step.name} - ${step.error}`, step.id)
      
      // Update node status to 'error'
      updateNodeStatus(step.nodeId, 'error')
      
      return false
    }
  }

  // =============================================================================
  // Deployment Control
  // =============================================================================

  /**
   * Load a deployment plan
   */
  function loadPlan(plan: DeploymentPlan) {
    currentPlan.value = plan
    clearLogs()
    addLog('info', `Loaded deployment plan: ${plan.name}`)
  }

  /**
   * Start or resume deployment
   */
  async function startDeployment(): Promise<boolean> {
    if (!currentPlan.value) {
      addLog('error', 'No deployment plan loaded')
      return false
    }

    if (isDeploying.value && !isPaused.value) {
      addLog('warning', 'Deployment already in progress')
      return false
    }

    isDeploying.value = true
    isPaused.value = false
    abortController = new AbortController()

    if (!startTime.value) {
      startTime.value = new Date().toISOString()
      currentPlan.value.status = 'deploying'
      currentPlan.value.startedAt = startTime.value
    }

    addLog('info', 'Starting deployment...')

    // Execute steps sequentially
    for (const step of currentPlan.value.steps) {
      // Skip already completed/deployed steps
      if (step.status === 'completed') {
        if (step.type === 'noop') {
          addLog('info', `Skipping: ${step.name} (already on Proxmox)`, step.id)
        }
        continue
      }

      // Check for pause/cancel
      if (isPaused.value) {
        addLog('info', 'Deployment paused')
        return true
      }

      if (abortController?.signal.aborted) {
        addLog('warning', 'Deployment cancelled')
        currentPlan.value.status = 'cancelled'
        isDeploying.value = false
        return false
      }

      // Execute the step
      const success = await executeStep(step)

      if (!success) {
        // Stop on failure
        currentPlan.value.status = 'failed'
        endTime.value = new Date().toISOString()
        currentPlan.value.completedAt = endTime.value
        isDeploying.value = false
        addLog('error', 'Deployment failed')
        return false
      }

      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // All steps completed
    currentPlan.value.status = 'completed'
    endTime.value = new Date().toISOString()
    currentPlan.value.completedAt = endTime.value
    isDeploying.value = false
    addLog('success', 'Deployment completed successfully!')
    return true
  }

  /**
   * Pause deployment
   */
  function pauseDeployment() {
    if (isDeploying.value) {
      isPaused.value = true
      addLog('info', 'Pausing deployment...')
    }
  }

  /**
   * Cancel deployment
   */
  function cancelDeployment() {
    if (abortController) {
      abortController.abort()
    }
    isPaused.value = false
    isDeploying.value = false
    addLog('warning', 'Deployment cancelled by user')
  }

  /**
   * Reset deployment state
   */
  function resetDeployment() {
    if (currentPlan.value) {
      // Reset all step statuses
      currentPlan.value.steps.forEach(step => {
        step.status = 'pending'
        step.startedAt = undefined
        step.completedAt = undefined
        step.error = undefined
        step.progress = undefined
      })
      currentPlan.value.status = 'draft'
      currentPlan.value.startedAt = undefined
      currentPlan.value.completedAt = undefined
    }

    isDeploying.value = false
    isPaused.value = false
    startTime.value = null
    endTime.value = null
    clearLogs()
    addLog('info', 'Deployment reset')
  }

  /**
   * Clear current deployment
   */
  function clearDeployment() {
    currentPlan.value = null
    isDeploying.value = false
    isPaused.value = false
    startTime.value = null
    endTime.value = null
    clearLogs()
  }

  /**
   * Retry a failed step
   */
  async function retryStep(stepId: string): Promise<boolean> {
    if (!currentPlan.value) return false

    const step = currentPlan.value.steps.find(s => s.id === stepId)
    if (!step || step.status !== 'failed') {
      addLog('error', 'Cannot retry: step not found or not failed')
      return false
    }

    step.status = 'pending'
    step.error = undefined
    
    return executeStep(step)
  }

  /**
   * Skip a step
   */
  function skipStep(stepId: string) {
    if (!currentPlan.value) return

    const step = currentPlan.value.steps.find(s => s.id === stepId)
    if (step && (step.status === 'pending' || step.status === 'failed')) {
      step.status = 'skipped'
      addLog('warning', `Skipped: ${step.name}`, step.id)
    }
  }

  // =============================================================================
  // Return
  // =============================================================================

  return {
    // State
    currentPlan: computed(() => currentPlan.value),
    isDeploying: computed(() => isDeploying.value),
    isPaused: computed(() => isPaused.value),
    logs: computed(() => logs.value),
    startTime: computed(() => startTime.value),
    endTime: computed(() => endTime.value),

    // Computed
    progress,
    currentStep,
    completedSteps,
    failedSteps,
    pendingSteps,

    // Actions
    loadPlan,
    startDeployment,
    pauseDeployment,
    cancelDeployment,
    resetDeployment,
    clearDeployment,
    retryStep,
    skipStep,
    addLog,
    clearLogs,

    // SSE (§C4.1)
    deployments,
    subscribe,
    unsubscribe,
    getOrCreateRecord,
  }
})

export default useDeploymentStore

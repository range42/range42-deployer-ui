/**
 * heartbeat.worker.ts — SharedWorker that coordinates project-lock heartbeats
 * across every tab editing a given project.
 *
 * Protocol (via MessagePort):
 *   { cmd: 'start', projectId, endpoint }
 *   { cmd: 'stop',  projectId }
 *
 * Responses:
 *   { kind: 'stale', projectId }           — 3 × 60s missed heartbeats
 *   { kind: 'tick',  projectId }           — each successful heartbeat
 *
 * Stale threshold: 3 × 60s = 180s (spec §4).
 */

export const HEARTBEAT_INTERVAL_MS = 60_000
export const STALE_THRESHOLD_MS = 3 * HEARTBEAT_INTERVAL_MS

interface HeartbeatState {
  abort: AbortController
  intervalId: ReturnType<typeof setInterval>
  endpoint: string
  lastOk: number
  ports: Set<MessagePort>
}

interface StartCmd {
  cmd: 'start'
  projectId: string
  endpoint: string
}
interface StopCmd {
  cmd: 'stop'
  projectId: string
}
type IncomingCmd = StartCmd | StopCmd

// Exposed for integration testing — pure module-level helper.
export function makeHeartbeatMessageHandler(
  state: Map<string, HeartbeatState>,
  fetchImpl: typeof fetch = globalThis.fetch,
  locksImpl: LockManager | undefined = globalThis.navigator?.locks,
) {
  async function start(msg: StartCmd, port: MessagePort): Promise<void> {
    let entry = state.get(msg.projectId)
    if (entry) {
      entry.ports.add(port)
      return
    }
    const abort = new AbortController()
    const ports = new Set<MessagePort>([port])
    const intervalId = setInterval(async () => {
      const item = state.get(msg.projectId)
      if (!item) return
      try {
        const res = await fetchImpl(item.endpoint, { method: 'POST' })
        if (res.ok) {
          item.lastOk = Date.now()
          for (const p of item.ports) p.postMessage({ kind: 'tick', projectId: msg.projectId })
        } else if (Date.now() - item.lastOk > STALE_THRESHOLD_MS) {
          for (const p of item.ports) p.postMessage({ kind: 'stale', projectId: msg.projectId })
        }
      } catch {
        if (Date.now() - item.lastOk > STALE_THRESHOLD_MS) {
          for (const p of item.ports) p.postMessage({ kind: 'stale', projectId: msg.projectId })
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
    entry = {
      abort,
      intervalId,
      endpoint: msg.endpoint,
      lastOk: Date.now(),
      ports,
    }
    state.set(msg.projectId, entry)
    // Hold a shared navigator lock so the browser keeps us alive across tab
    // transitions. The lock is released on abort.
    if (locksImpl) {
      void locksImpl
        .request(
          `range42-edit-${msg.projectId}`,
          { mode: 'shared', signal: abort.signal } as LockOptions,
          () =>
            new Promise<void>((resolve) => {
              const s = abort.signal
              if (s.aborted) return resolve()
              s.addEventListener('abort', () => resolve(), { once: true })
            }),
        )
        .catch(() => {
          // abort or lock rejection — benign
        })
    }
  }

  function stop(msg: StopCmd): void {
    const entry = state.get(msg.projectId)
    if (!entry) return
    clearInterval(entry.intervalId)
    entry.abort.abort()
    state.delete(msg.projectId)
  }

  return function onMessage(port: MessagePort, data: IncomingCmd) {
    if (data.cmd === 'start') void start(data, port)
    else if (data.cmd === 'stop') stop(data)
  }
}

// In a real SharedWorker context, `onconnect` binds per-port handlers.
declare const self: SharedWorkerGlobalScope

// Only run the connect wiring in an actual SharedWorker scope; Vitest imports
// this module in Node where no `onconnect` is defined.
if (typeof self !== 'undefined' && 'onconnect' in self) {
  const state = new Map<string, HeartbeatState>()
  const handle = makeHeartbeatMessageHandler(state)
  self.onconnect = (e) => {
    const port = e.ports[0]
    port.addEventListener('message', (ev) => handle(port, ev.data))
    port.start()
  }
}

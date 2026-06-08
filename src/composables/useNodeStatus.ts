export type DotColor = 'green' | 'gray' | 'orange' | 'red' | 'blue'

export interface NodeStatusView {
  dotColor: DotColor
  label: string
  pulse: boolean
}

const STATUS_TO_COLOR: Record<string, DotColor> = {
  running: 'green', green: 'green',
  stopped: 'gray', gray: 'gray',
  paused: 'orange', orange: 'orange',
  error: 'red', red: 'red',
  deploying: 'blue', blue: 'blue',
}

const PULSING_STATUS = new Set(['deploying', 'blue'])

// pendingAction → transitional view. `red`/deleting pulses so it is distinct
// from the steady `error` red.
const PENDING: Record<string, { dotColor: DotColor; label: string }> = {
  delete: { dotColor: 'red', label: 'deleting' },
  stop: { dotColor: 'orange', label: 'stopping' },
  'force-stop': { dotColor: 'orange', label: 'stopping' },
  pause: { dotColor: 'orange', label: 'pausing' },
  start: { dotColor: 'blue', label: 'starting' },
  resume: { dotColor: 'blue', label: 'resuming' },
  restart: { dotColor: 'blue', label: 'restarting' },
}

export function resolveNodeStatus(
  status: string | undefined | null,
  pendingAction?: string | null,
): NodeStatusView {
  if (pendingAction && PENDING[pendingAction]) {
    const p = PENDING[pendingAction]
    return { dotColor: p.dotColor, label: p.label, pulse: true }
  }
  const dotColor = STATUS_TO_COLOR[status ?? ''] ?? 'gray'
  return { dotColor, label: status ?? 'unknown', pulse: PULSING_STATUS.has(status ?? '') }
}


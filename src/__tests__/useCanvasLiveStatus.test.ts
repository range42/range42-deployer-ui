import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import {
  mapStatusFromEvent,
  resolveNodeId,
  useCanvasLiveStatus,
} from '@/composables/useCanvasLiveStatus'
import type { DeploymentRecord } from '@/stores/deploymentStore'

function emptyRecord(id: string): DeploymentRecord {
  return {
    id,
    state: 'unknown',
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

describe('mapStatusFromEvent', () => {
  it('task_start → blue', () => {
    expect(mapStatusFromEvent({ event_type: 'task_start', event_seq: 1, payload: {} })).toBe('blue')
  })
  it('task_end ok → green', () => {
    expect(mapStatusFromEvent({ event_type: 'task_end', event_seq: 2, payload: { result: 'ok' } })).toBe('green')
  })
  it('task_end failed → red', () => {
    expect(mapStatusFromEvent({ event_type: 'task_end', event_seq: 3, payload: { result: 'failed' } })).toBe('red')
  })
  it('host_unreachable → orange', () => {
    expect(mapStatusFromEvent({ event_type: 'host_unreachable', event_seq: 4, payload: {} })).toBe('orange')
  })
  it('unknown event returns undefined', () => {
    expect(mapStatusFromEvent({ event_type: 'heartbeat', event_seq: 5, payload: {} })).toBeUndefined()
  })
})

describe('resolveNodeId', () => {
  it('calls lookup with host/node_id/vm_id', () => {
    let captured: Record<string, unknown> | null = null
    const lookup = (ident: Record<string, unknown>) => {
      captured = ident
      return 'nid-1'
    }
    resolveNodeId(
      { event_type: 'task_start', event_seq: 1, payload: { node_id: 'vm-a', host: 'h1', vm_id: 100 } },
      lookup,
    )
    expect(captured).toEqual({ node_id: 'vm-a', host: 'h1', vm_id: 100 })
  })
})

describe('useCanvasLiveStatus', () => {
  it('applyEvent transitions gray → blue → green', () => {
    const record = ref<DeploymentRecord | null>(emptyRecord('d-1'))
    const { statuses, applyEvent } = useCanvasLiveStatus(record, () => 'node-1')
    applyEvent({ event_type: 'task_start', event_seq: 1, payload: { node_id: 'node-1' } })
    expect(statuses.value.get('node-1')).toBe('blue')
    applyEvent({ event_type: 'task_end', event_seq: 2, payload: { node_id: 'node-1', result: 'ok' } })
    expect(statuses.value.get('node-1')).toBe('green')
  })

  it('applyEvent sets red on failed task_end', () => {
    const record = ref<DeploymentRecord | null>(emptyRecord('d-2'))
    const { statuses, applyEvent } = useCanvasLiveStatus(record, () => 'node-X')
    applyEvent({ event_type: 'task_end', event_seq: 1, payload: { result: 'failed', node_id: 'node-X' } })
    expect(statuses.value.get('node-X')).toBe('red')
  })

  it('applyEvent sets orange on host_unreachable', () => {
    const record = ref<DeploymentRecord | null>(emptyRecord('d-3'))
    const { statuses, applyEvent } = useCanvasLiveStatus(record, () => 'node-Y')
    applyEvent({ event_type: 'host_unreachable', event_seq: 1, payload: { node_id: 'node-Y' } })
    expect(statuses.value.get('node-Y')).toBe('orange')
  })

  it('skips when resolver returns null', () => {
    const record = ref<DeploymentRecord | null>(emptyRecord('d-4'))
    const { statuses, applyEvent } = useCanvasLiveStatus(record, () => null)
    applyEvent({ event_type: 'task_start', event_seq: 1, payload: {} })
    expect(statuses.value.size).toBe(0)
  })
})

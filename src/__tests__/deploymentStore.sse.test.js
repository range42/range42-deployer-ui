import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  useDeploymentStore,
  applySseEvent,
  computeBackoff,
  pushRing,
  SSE_MAX_RETRIES,
  SSE_BACKOFF_MAX_MS,
  LOG_RING_CAPACITY,
} from '../stores/deploymentStore.ts';

// -----------------------------------------------------------------------------
// Mock EventSource — records instances and lets tests drive onopen/onmessage/
// onerror manually.
// -----------------------------------------------------------------------------

function createMockEventSourceClass() {
  const instances = [];
  class MockEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    constructor(url) {
      this.url = url;
      this.readyState = MockEventSource.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.closed = false;
      instances.push(this);
    }
    open() {
      this.readyState = MockEventSource.OPEN;
      if (this.onopen) this.onopen(new Event('open'));
    }
    emit(eventObj) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(eventObj) });
    }
    fail() {
      if (this.onerror) this.onerror(new Event('error'));
    }
    close() {
      this.readyState = MockEventSource.CLOSED;
      this.closed = true;
    }
  }
  return { MockEventSource, instances };
}

function emptyRecord(id = 'd1') {
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
  };
}

describe('deploymentStore.applySseEvent — all 12 event types from spec §18.2', () => {
  it('handles state_transition', () => {
    const r = emptyRecord();
    applySseEvent(r, { event_type: 'state_transition', event_seq: 1, payload: { from: 'draft', to: 'deploying' } });
    expect(r.state).toBe('deploying');
    expect(r.last_event_seq).toBe(1);
  });

  it('handles phase_transition', () => {
    const r = emptyRecord();
    applySseEvent(r, { event_type: 'phase_transition', event_seq: 2, payload: { from: 'networks', to: 'vms' } });
    expect(r.phase).toBe('vms');
  });

  it('handles task_start (sets team status to deploying + last_task)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'task_start',
      event_seq: 3,
      payload: { task_name: 'Create VM 9001', host: 'pve01', team_id: 't1', node_id: 'n1' },
    });
    expect(r.teams.t1).toBeDefined();
    expect(r.teams.t1.status).toBe('deploying');
    expect(r.teams.t1.last_task).toBe('Create VM 9001');
  });

  it('handles task_end failed → team failed', () => {
    const r = emptyRecord();
    applySseEvent(r, { event_type: 'task_start', event_seq: 4, payload: { task_name: 't', team_id: 't1' } });
    applySseEvent(r, {
      event_type: 'task_end',
      event_seq: 5,
      payload: { task_name: 't', host: 'h', result: 'failed', rc: 2, duration_ms: 120, team_id: 't1' },
    });
    expect(r.teams.t1.status).toBe('failed');
  });

  it('handles host_unreachable (records host on team)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'host_unreachable',
      event_seq: 6,
      payload: { host: 'vm-9001', team_id: 't1', retry_budget_remaining: 2 },
    });
    expect(r.teams.t1.unreachable_hosts).toContain('vm-9001');
  });

  it('handles log_line (shared buffer when team_id absent)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'log_line',
      event_seq: 7,
      ts: '2026-04-14T10:00:00Z',
      payload: { stream: 'stdout', text: 'hello' },
    });
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0].text).toBe('hello');
    expect(r.logs[0].stream).toBe('stdout');
    applySseEvent(r, { event_type: 'log_line', event_seq: 2, payload: {
      text: 'included task', ansible_event: 'playbook_on_include', task_action: 'include_tasks',
    } });
    expect(r.logs[1].ansible_event).toBe('playbook_on_include');
    expect(r.logs[1].task_action).toBe('include_tasks');
  });

  it('handles log_line routed to team ring buffer when team_id present', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'log_line',
      event_seq: 8,
      payload: { stream: 'stderr', text: 'oops', team_id: 't2' },
    });
    expect(r.teams.t2.latest_logs).toHaveLength(1);
    expect(r.teams.t2.latest_logs[0].stream).toBe('stderr');
  });

  it('handles redaction (increments per-rule counter)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'redaction',
      event_seq: 9,
      payload: { layer: 'content_regex', rule_id: 'regex:pem-block', field_path: 'x' },
    });
    applySseEvent(r, {
      event_type: 'redaction',
      event_seq: 10,
      payload: { layer: 'content_regex', rule_id: 'regex:pem-block', field_path: 'y' },
    });
    expect(r.redaction_counters['regex:pem-block']).toBe(2);
  });

  it('handles heartbeat (records timestamp)', () => {
    const r = emptyRecord();
    applySseEvent(r, { event_type: 'heartbeat', event_seq: 11, ts: '2026-04-14T10:01:00Z', payload: {} });
    expect(r.last_heartbeat_at).toBe('2026-04-14T10:01:00Z');
  });

  it('handles attempt_start (records attempt_id)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'attempt_start',
      event_seq: 12,
      payload: { attempt_id: 'att-7', scope: 'deployment' },
    });
    expect(r.attempt_id).toBe('att-7');
  });

  it('handles attempt_end (sets state to terminal_state)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'attempt_end',
      event_seq: 13,
      payload: { attempt_id: 'att-7', terminal_state: 'deployed' },
    });
    expect(r.state).toBe('deployed');
  });

  it('handles proxmox_task (appends task row)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'proxmox_task',
      event_seq: 14,
      payload: { task_uuid: 'UPID:x', kind: 'qmstart', vm_id: 9001, node: 'pve01' },
    });
    expect(r.proxmox_tasks).toHaveLength(1);
    expect(r.proxmox_tasks[0].vm_id).toBe(9001);
  });

  it('handles preflight_check (appends result)', () => {
    const r = emptyRecord();
    applySseEvent(r, {
      event_type: 'preflight_check',
      event_seq: 15,
      payload: { check: 'vmid_free', result: 'warn', detail: '9001 maybe used' },
    });
    expect(r.preflight_checks).toHaveLength(1);
    expect(r.preflight_checks[0].result).toBe('warn');
  });

  it('feeds a canned 12-event sequence and asserts full store state', () => {
    const r = emptyRecord();
    const seq = [
      { event_type: 'state_transition', event_seq: 1, payload: { from: 'draft', to: 'preflight' } },
      { event_type: 'preflight_check', event_seq: 2, payload: { check: 'vmid_free', result: 'pass' } },
      { event_type: 'state_transition', event_seq: 3, payload: { from: 'preflight', to: 'deploying' } },
      { event_type: 'attempt_start', event_seq: 4, payload: { attempt_id: 'att-1', scope: 'deployment' } },
      { event_type: 'phase_transition', event_seq: 5, payload: { from: 'init', to: 'networks' } },
      { event_type: 'task_start', event_seq: 6, payload: { task_name: 'create bridge', host: 'pve01', team_id: 't1' } },
      { event_type: 'proxmox_task', event_seq: 7, payload: { task_uuid: 'UPID:a', kind: 'sdn', node: 'pve01' } },
      { event_type: 'log_line', event_seq: 8, payload: { stream: 'stdout', text: 'creating…', team_id: 't1' } },
      { event_type: 'redaction', event_seq: 9, payload: { layer: 'vault_tagged', rule_id: 'vault:tagged-value' } },
      { event_type: 'task_end', event_seq: 10, payload: { task_name: 'create bridge', host: 'pve01', result: 'ok', team_id: 't1' } },
      { event_type: 'host_unreachable', event_seq: 11, payload: { host: 'vm-9001', team_id: 't1' } },
      { event_type: 'heartbeat', event_seq: 12, ts: '2026-04-14T10:05:00Z', payload: {} },
      { event_type: 'attempt_end', event_seq: 13, payload: { attempt_id: 'att-1', terminal_state: 'deployed' } },
    ];
    for (const e of seq) applySseEvent(r, e);
    expect(r.last_event_seq).toBe(13);
    expect(r.state).toBe('deployed');
    expect(r.attempt_id).toBe('att-1');
    expect(r.phase).toBe('networks');
    expect(r.teams.t1.latest_logs.length).toBe(1);
    expect(r.teams.t1.unreachable_hosts).toContain('vm-9001');
    expect(r.proxmox_tasks.length).toBe(1);
    expect(r.redaction_counters['vault:tagged-value']).toBe(1);
    expect(r.preflight_checks.length).toBe(1);
    expect(r.last_heartbeat_at).toBe('2026-04-14T10:05:00Z');
  });

  it('ignores unknown event types (forward-compat)', () => {
    const r = emptyRecord();
    applySseEvent(r, { event_type: 'some_future_event', event_seq: 99, payload: {} });
    expect(r.last_event_seq).toBe(99);
    expect(r.state).toBe('unknown');
  });
});

describe('deploymentStore.pushRing — log buffer caps at LOG_RING_CAPACITY', () => {
  it('caps at 200 lines (oldest dropped)', () => {
    const buf = [];
    for (let i = 0; i < LOG_RING_CAPACITY + 50; i++) {
      pushRing(buf, { ts: 't', stream: 'stdout', text: `line-${i}` });
    }
    expect(buf.length).toBe(LOG_RING_CAPACITY);
    expect(buf[0].text).toBe(`line-50`); // first 50 dropped
    expect(buf[buf.length - 1].text).toBe(`line-${LOG_RING_CAPACITY + 49}`);
  });
});

describe('deploymentStore.computeBackoff — bounded exponential', () => {
  it('starts at base and clamps at SSE_BACKOFF_MAX_MS', () => {
    expect(computeBackoff(0)).toBe(1000);
    expect(computeBackoff(1)).toBe(2000);
    expect(computeBackoff(2)).toBe(4000);
    // clamps
    expect(computeBackoff(20)).toBe(SSE_BACKOFF_MAX_MS);
    expect(computeBackoff(100)).toBe(SSE_BACKOFF_MAX_MS);
  });
});

describe('deploymentStore.subscribe — EventSource lifecycle + reconnect', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens EventSource with from_cursor=0 on first subscribe', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    const setTimeoutFn = vi.fn((cb, ms) => setTimeout(cb, ms));

    store.subscribe('dep-1', {
      eventSourceCtor: MockEventSource,
      setTimeoutFn,
      baseUrl: 'http://api.test',
    });
    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe('http://api.test/v1/deployments/dep-1/events?from_cursor=0');
  });

  it('reconnects with from_cursor = last seen event_seq after error, bounded backoff', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    const scheduled = [];
    const setTimeoutFn = (cb, ms) => {
      scheduled.push({ cb, ms });
      // Fire immediately (test-synchronous).
      cb();
      return 0;
    };

    store.subscribe('dep-2', {
      eventSourceCtor: MockEventSource,
      setTimeoutFn,
      baseUrl: '',
    });

    // Consume 3 events so last_event_seq = 17.
    instances[0].open();
    instances[0].emit({ event_type: 'state_transition', event_seq: 15, payload: { to: 'deploying' } });
    instances[0].emit({ event_type: 'log_line', event_seq: 16, payload: { stream: 'stdout', text: 'a' } });
    instances[0].emit({ event_type: 'log_line', event_seq: 17, payload: { stream: 'stdout', text: 'b' } });

    // Simulate connection drop.
    instances[0].fail();

    // A new EventSource should have been opened with from_cursor=17.
    expect(instances.length).toBe(2);
    expect(instances[1].url).toBe('/v1/deployments/dep-2/events?from_cursor=17');
    expect(scheduled.length).toBe(1);
    expect(scheduled[0].ms).toBe(1000); // first backoff
    // 2nd stream instantiated but onopen not fired yet → connecting
    expect(store.deployments['dep-2'].connection).toBe('connecting');
    expect(store.deployments['dep-2'].retry_count).toBe(1);
    // On successful re-open, retry_count resets + connection goes open.
    instances[1].open();
    expect(store.deployments['dep-2'].connection).toBe('open');
    expect(store.deployments['dep-2'].retry_count).toBe(0);
  });

  it('caps reconnects at SSE_MAX_RETRIES then marks connection exhausted', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    const setTimeoutFn = (cb, _ms) => { cb(); return 0 };

    store.subscribe('dep-3', { eventSourceCtor: MockEventSource, setTimeoutFn });

    // Fail repeatedly; each failure should schedule a new connection until cap.
    for (let i = 0; i < SSE_MAX_RETRIES + 2; i++) {
      const last = instances[instances.length - 1];
      last.fail();
    }
    expect(store.deployments['dep-3'].connection).toBe('exhausted');
    // Cap: original + SSE_MAX_RETRIES reconnects.
    expect(instances.length).toBe(1 + SSE_MAX_RETRIES);
  });

  it('unsubscribe closes EventSource and clears retry state', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    store.subscribe('dep-4', { eventSourceCtor: MockEventSource });
    store.unsubscribe('dep-4');
    expect(instances[0].closed).toBe(true);
    expect(store.deployments['dep-4'].connection).toBe('closed');
  });

  it('does not open a duplicate EventSource if already subscribed', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    store.subscribe('dep-5', { eventSourceCtor: MockEventSource });
    store.subscribe('dep-5', { eventSourceCtor: MockEventSource });
    expect(instances.length).toBe(1);
  });

  it('seeds last_event_seq from explicit from_cursor option', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    store.subscribe('dep-6', { eventSourceCtor: MockEventSource, from_cursor: 42 });
    expect(instances[0].url).toContain('from_cursor=42');
    expect(store.deployments['dep-6'].last_event_seq).toBe(42);
  });
});

describe('deploymentStore.onEvent — observer hook', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('notifies observers with (deploymentId, event) after an SSE event is applied', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    const seen = [];
    store.onEvent((deploymentId, event) => seen.push({ deploymentId, event }));

    store.subscribe('dep-obs', { eventSourceCtor: MockEventSource, baseUrl: '' });
    instances[0].open();
    instances[0].emit({ event_type: 'log_line', event_seq: 1, payload: { stream: 'stdout', text: 'hi' } });

    expect(seen).toHaveLength(1);
    expect(seen[0].deploymentId).toBe('dep-obs');
    expect(seen[0].event.event_type).toBe('log_line');
    expect(seen[0].event.payload.text).toBe('hi');
    // applySseEvent still ran (observer notified IN ADDITION, not instead).
    expect(store.deployments['dep-obs'].logs).toHaveLength(1);
  });

  it('returns an unsubscribe function that removes the observer', () => {
    const store = useDeploymentStore();
    const { MockEventSource, instances } = createMockEventSourceClass();
    const seen = [];
    const off = store.onEvent((id, event) => seen.push({ id, event }));
    off();

    store.subscribe('dep-off', { eventSourceCtor: MockEventSource, baseUrl: '' });
    instances[0].open();
    instances[0].emit({ event_type: 'heartbeat', event_seq: 1, payload: {} });

    expect(seen).toHaveLength(0);
  });
});

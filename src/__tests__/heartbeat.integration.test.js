import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  makeHeartbeatMessageHandler,
  HEARTBEAT_INTERVAL_MS,
  STALE_THRESHOLD_MS,
} from '../services/projectRepo/heartbeat.worker';

// Fake navigator.locks that immediately resolves the callback as "held".
const fakeLocks = {
  request: vi.fn(async (_name, _opts, cb) => {
    // Call the callback but don't await it — simulates "lock is held".
    cb();
  }),
};

function makePort() {
  return {
    messages: [],
    postMessage(m) { this.messages.push(m); },
  };
}

describe('SharedWorker heartbeat integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires one fetch per 60s interval while locked', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const state = new Map();
    const handle = makeHeartbeatMessageHandler(state, fetchImpl, fakeLocks);
    const port = makePort();

    handle(port, { cmd: 'start', projectId: 'p1', endpoint: '/v1/projects/p1/heartbeat' });
    // Let the (micro)task that requested the lock settle, then advance timers.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const ticks = port.messages.filter((m) => m.kind === 'tick');
    expect(ticks.length).toBe(3);
    expect(ticks[0]).toEqual({ kind: 'tick', projectId: 'p1' });

    handle(port, { cmd: 'stop', projectId: 'p1' });
  });

  it('emits stale once past 180s of failed heartbeats', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const state = new Map();
    const handle = makeHeartbeatMessageHandler(state, fetchImpl, fakeLocks);
    const port = makePort();

    handle(port, { cmd: 'start', projectId: 'p2', endpoint: '/x' });
    // Tick past the stale threshold (3 intervals).
    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + HEARTBEAT_INTERVAL_MS);

    const stale = port.messages.filter((m) => m.kind === 'stale');
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale[0]).toEqual({ kind: 'stale', projectId: 'p2' });

    handle(port, { cmd: 'stop', projectId: 'p2' });
  });

  it('stop clears the interval and removes state', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const state = new Map();
    const handle = makeHeartbeatMessageHandler(state, fetchImpl, fakeLocks);
    const port = makePort();
    handle(port, { cmd: 'start', projectId: 'p3', endpoint: '/x' });
    expect(state.size).toBe(1);
    handle(port, { cmd: 'stop', projectId: 'p3' });
    expect(state.size).toBe(0);
    // No further ticks.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 5);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

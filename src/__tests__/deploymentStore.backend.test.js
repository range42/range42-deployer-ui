import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useDeploymentStore } from '@/stores/deploymentStore'

let store
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  store = useDeploymentStore()
})
afterEach(() => {
  for (const id of Object.keys(store.deployments)) store.unsubscribe(id)
  vi.unstubAllGlobals()
})

describe('backend deployment streams', () => {
  it('does not expose an alternate browser-side deployment executor', () => {
    expect(store.startDeployment).toBeUndefined()
    expect(store.retryStep).toBeUndefined()
    expect(store.skipStep).toBeUndefined()
  })

  it('uses the selected backend and listens for named backend SSE events', () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://backend.test' })
    const streams = []
    class TestEventSource {
      constructor(url) { this.url = url; this.listeners = {}; streams.push(this) }
      addEventListener(name, callback) { this.listeners[name] = callback }
      close() {}
    }
    vi.stubGlobal('EventSource', TestEventSource)
    store.subscribe('dep')
    const stream = streams[0]
    expect(stream.url).toBe('https://backend.test/v1/deployments/dep/events?from_cursor=0')
    expect(stream.listeners.state_transition).toBeTypeOf('function')
    stream.listeners.state_transition({ data: JSON.stringify({
      event_type: 'state_transition', event_seq: 1, payload: { to: 'deploying' },
    }) })
    expect(store.deployments.dep.state).toBe('deploying')
  })

  it('streams named events with a bearer header across chunk boundaries', async () => {
    useBackendApiStore().addHost({ url: 'https://backend.test', token: 'gateway' })
    let writer
    const body = new ReadableStream({ start(controller) { writer = controller } })
    const fetch = vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body,
    }))
    vi.stubGlobal('fetch', fetch)
    store.subscribe('dep')
    await flushPromises()
    expect(fetch).toHaveBeenCalledOnce()
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://backend.test/v1/deployments/dep/events?from_cursor=0')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer gateway')
    const bytes = new TextEncoder().encode('event: state_transition\r\ndata: {"event_type":"state_transition",\r\ndata: "event_seq":7,"payload":{"to":"deploying"}}\r\n\r\n')
    writer.enqueue(bytes.slice(0, 25))
    writer.enqueue(bytes.slice(25, -2))
    writer.enqueue(bytes.slice(-2))
    await flushPromises()
    expect(store.deployments.dep.state).toBe('deploying')
    expect(store.deployments.dep.last_event_seq).toBe(7)
    store.unsubscribe('dep')
    expect(options.signal.aborted).toBe(true)
  })

  it('drops deployment state and closes old streams when backend changes', () => {
    const backend = useBackendApiStore()
    backend.addHost({ url: 'https://old.test' })
    const next = backend.addHost({ url: 'https://new.test' })
    const close = vi.fn()
    class TestEventSource { close = close }
    vi.stubGlobal('EventSource', TestEventSource)
    store.subscribe('dep')
    store.getOrCreateRecord('dep').state = 'deploying'
    backend.setActiveHost(next)
    expect(close).toHaveBeenCalledOnce()
    expect(store.deployments.dep).toBeUndefined()
  })
})

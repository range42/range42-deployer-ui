/**
 * Plan C §C6.1 — Playwright mock API + SSE harness.
 *
 * Installs lightweight in-browser fakes for:
 *   - `fetch` against `/v1/*` (via Playwright `page.route`).
 *   - `EventSource` against `/v1/deployments/:id/events` (via an init script
 *     that shims `window.EventSource` with a controllable queue).
 *
 * A test controls the mock by calling the exported helpers; there is no
 * separate server process — Playwright's page-level interception is enough
 * to satisfy every /v1 call the UI makes during Plan C flows.
 */
import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Canned event sequences
// ---------------------------------------------------------------------------

export type CannedScenario = 'happy' | 'cancel' | 'cancel-tail' | 'reconnect-prefix' | 'reconnect-tail'

export interface SseEvent {
  event_type: string
  event_seq: number
  attempt_id?: string
  ts?: string
  payload?: Record<string, unknown>
}

/** Parse a JSONL file from e2e/fixtures/events into a list of events. */
export function loadEvents(scenario: CannedScenario): SseEvent[] {
  const path = join(__dirname, 'events', `${scenario}.jsonl`)
  const raw = readFileSync(path, 'utf8')
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SseEvent)
}

// ---------------------------------------------------------------------------
// REST fixture payloads
// ---------------------------------------------------------------------------

export interface ProxmoxHost {
  id: string
  name: string
  node_name?: string
}

export interface DeploymentMeta {
  id: string
  codename: string
  scenario_label?: string
  state: string
  team_count?: number
  attempts?: Array<{ attempt_id?: string; state: string; started_at?: string }>
}

export interface CatalogEntry {
  kind: 'lab' | 'gamenet' | 'component' | string
  name: string
  description?: string
  tags?: string[]
  source_id: string
  path: string
  updated_at?: string
  difficulty?: string
  os?: string
  sha?: string
  readme?: string
  topology?: Record<string, unknown>
  inventory?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
}

export interface MockApiState {
  hosts: ProxmoxHost[]
  catalog: CatalogEntry[]
  deployments: Map<string, DeploymentMeta>
  preflightResponse: { blocking: boolean; checks: Array<{ check: string; result: string; detail?: string }> }
  createdDeploymentId: string
  cancelledIds: Set<string>
  postedBodies: Array<{ url: string; body: unknown }>
  onCreateDeployment?: (body: Record<string, unknown>) => DeploymentMeta
}

export function defaultState(): MockApiState {
  return {
    hosts: [
      { id: 'pve-mock-01', name: 'pve-mock-01', node_name: 'pve-mock-01' },
    ],
    catalog: [
      {
        kind: 'gamenet',
        name: 'demo-gamenet',
        description: 'Canned mock entry',
        source_id: 'gitlab:range42/catalog',
        path: 'gamenets/demo/range42.yaml',
        sha: 'abcdef1',
        readme: '# demo-gamenet\n\nCanned mock catalog entry for E2E tests.\n',
        tags: ['demo'],
        topology: { kind: 'gamenet' },
      },
    ],
    deployments: new Map(),
    preflightResponse: {
      blocking: false,
      checks: [
        { check: 'ssh_reachable', result: 'pass' },
        { check: 'vault_pass_present', result: 'pass' },
      ],
    },
    createdDeploymentId: 'dep-e2e-1',
    cancelledIds: new Set(),
    postedBodies: [],
  }
}

// ---------------------------------------------------------------------------
// Playwright entry point
// ---------------------------------------------------------------------------

export interface SetupMockApiOptions {
  state?: Partial<MockApiState>
  /**
   * Optional absolute base URL. The UI issues relative /v1/* requests so we
   * match both absolute and relative forms.
   */
  baseUrl?: string
}

export interface MockApiHandle {
  state: MockApiState
  pushEvent: (deploymentId: string, event: SseEvent) => Promise<void>
  pushEvents: (deploymentId: string, events: SseEvent[]) => Promise<void>
  closeStream: (deploymentId: string) => Promise<void>
  getPosts: (urlSubstr: string) => Array<{ url: string; body: unknown }>
  waitForPost: (urlSubstr: string, timeoutMs?: number) => Promise<{ url: string; body: unknown }>
  getSseOpenedUrls: () => Promise<string[]>
}

/**
 * Install REST route handlers and inject the fake EventSource into the page.
 * Must be called before `page.goto()` so the init script runs ahead of app code.
 */
export async function setupMockApi(
  page: Page,
  opts: SetupMockApiOptions = {},
): Promise<MockApiHandle> {
  const state: MockApiState = { ...defaultState(), ...(opts.state || {}) }

  // ---- SSE init script: shim EventSource before app bundles load ----
  await page.addInitScript(() => {
    // Avoid double-install on navigation.
    const w = window as unknown as {
      __range42_mock_sse__?: { openedUrls: string[]; queues: Record<string, unknown[]> }
      EventSource: typeof EventSource
    }
    if (w.__range42_mock_sse__) return

    interface FakeInstance {
      url: string
      readyState: number
      onopen: ((ev: Event) => void) | null
      onmessage: ((ev: MessageEvent) => void) | null
      onerror: ((ev: Event) => void) | null
      __queue: string[]
    }

    const openedUrls: string[] = []
    const instances = new Set<FakeInstance>()

    class FakeEventSource {
      readyState = 0
      onopen: ((ev: Event) => void) | null = null
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: Event) => void) | null = null
      url: string
      CONNECTING = 0
      OPEN = 1
      CLOSED = 2
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      constructor(url: string) {
        this.url = url
        openedUrls.push(url)
        const self: FakeInstance = this as unknown as FakeInstance
        self.__queue = []
        instances.add(self)
        // Open asynchronously so callers can attach handlers first.
        setTimeout(() => {
          self.readyState = 1
          try { this.onopen?.(new Event('open')) } catch { /* ignore */ }
        }, 0)
      }
      addEventListener(type: string, cb: EventListener) {
        if (type === 'message') this.onmessage = cb as (ev: MessageEvent) => void
        if (type === 'open') this.onopen = cb as (ev: Event) => void
        if (type === 'error') this.onerror = cb as (ev: Event) => void
      }
      removeEventListener() { /* noop */ }
      close() {
        this.readyState = 2
        instances.delete(this as unknown as FakeInstance)
      }
      dispatchEvent() { return true }
    }

    function pushTo(url: string, data: string) {
      for (const inst of instances) {
        if (inst.url === url || inst.url.startsWith(url + '?') || inst.url.startsWith(url + '&')) {
          if (inst.readyState !== 1) { inst.__queue.push(data); continue }
          try {
            inst.onmessage?.(new MessageEvent('message', { data }))
          } catch { /* ignore */ }
        }
      }
    }

    function pushToId(deploymentId: string, data: string) {
      for (const inst of instances) {
        if (inst.url.includes(`/v1/deployments/${deploymentId}/events`)) {
          if (inst.readyState !== 1) { inst.__queue.push(data); continue }
          try {
            inst.onmessage?.(new MessageEvent('message', { data }))
          } catch { /* ignore */ }
        }
      }
    }

    function closeForId(deploymentId: string) {
      for (const inst of instances) {
        if (inst.url.includes(`/v1/deployments/${deploymentId}/events`)) {
          try { inst.onerror?.(new Event('error')) } catch { /* ignore */ }
          inst.readyState = 2
          instances.delete(inst)
        }
      }
    }

    w.EventSource = FakeEventSource as unknown as typeof EventSource
    w.__range42_mock_sse__ = { openedUrls, queues: {} }
    ;(w as unknown as { __range42_push_sse__: (id: string, data: string) => void }).__range42_push_sse__
      = (id: string, data: string) => pushToId(id, data)
    ;(w as unknown as { __range42_push_sse_to_url__: (url: string, data: string) => void }).__range42_push_sse_to_url__
      = (url: string, data: string) => pushTo(url, data)
    ;(w as unknown as { __range42_close_sse__: (id: string) => void }).__range42_close_sse__
      = (id: string) => closeForId(id)
    ;(w as unknown as { __range42_opened_sse_urls__: () => string[] }).__range42_opened_sse_urls__
      = () => openedUrls.slice()
  })

  // ---- REST route handler ----
  const handler = async (route: Route) => {
    const req = route.request()
    const method = req.method()
    const url = new URL(req.url())
    const pathname = url.pathname

    // Record POSTs for later assertion.
    if (method !== 'GET' && method !== 'HEAD') {
      let body: unknown = null
      try { body = req.postDataJSON() } catch { body = req.postData() }
      state.postedBodies.push({ url: req.url(), body })
    }

    // GET /v1/proxmox/hosts
    if (pathname === '/v1/proxmox/hosts' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.hosts) })
      return
    }

    // GET /v1/catalog/entries
    if (pathname === '/v1/catalog/entries' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: state.catalog, source_sha: 'mocksha' }),
      })
      return
    }

    // GET /v1/catalog/entries/:source/* — entry detail
    const entryMatch = pathname.match(/^\/v1\/catalog\/entries\/([^/]+)\/(.+)$/)
    if (entryMatch && method === 'GET') {
      const source = decodeURIComponent(entryMatch[1])
      const path = entryMatch[2].split('/').map(decodeURIComponent).join('/')
      const entry = state.catalog.find((e) => e.source_id === source && e.path === path)
      if (entry) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entry) })
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
      }
      return
    }

    // POST /v1/projects/:id/validate (preflight)
    if (/^\/v1\/projects\/[^/]+\/validate$/.test(pathname) && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.preflightResponse),
      })
      return
    }

    // POST /v1/deployments — create
    if (pathname === '/v1/deployments' && method === 'POST') {
      const body = (req.postDataJSON() || {}) as Record<string, unknown>
      let meta: DeploymentMeta
      if (state.onCreateDeployment) {
        meta = state.onCreateDeployment(body)
      } else {
        meta = {
          id: state.createdDeploymentId,
          codename: String(body.codename || 'mock-codename'),
          scenario_label: String(body.scenario_label || ''),
          state: 'preflight',
          team_count: typeof body.team_count === 'number' ? body.team_count : 1,
          attempts: [{ attempt_id: 'a-1', state: 'preflight', started_at: '2026-04-14T10:00:00Z' }],
        }
      }
      state.deployments.set(meta.id, meta)
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(meta) })
      return
    }

    // GET /v1/deployments/:id
    const detailMatch = pathname.match(/^\/v1\/deployments\/([^/]+)$/)
    if (detailMatch && method === 'GET') {
      const id = detailMatch[1]
      const meta = state.deployments.get(id)
      if (meta) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) })
      } else {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
      }
      return
    }

    // POST /v1/deployments/:id/cancel
    const cancelMatch = pathname.match(/^\/v1\/deployments\/([^/]+)\/cancel$/)
    if (cancelMatch && method === 'POST') {
      const id = cancelMatch[1]
      state.cancelledIds.add(id)
      const meta = state.deployments.get(id)
      if (meta) meta.state = 'cancelled'
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }

    // GET /v1/deployments/:id/snapshots
    const snapsMatch = pathname.match(/^\/v1\/deployments\/([^/]+)\/snapshots$/)
    if (snapsMatch && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      return
    }

    // Default: 404 JSON (keeps error banners deterministic).
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'mock_not_matched', path: pathname }),
    })
  }

  await page.route('**/v1/**', handler)

  // ---- Handle helpers ----

  return {
    state,
    async pushEvent(deploymentId, event) {
      await page.evaluate(
        ([id, data]) => {
          const w = window as unknown as { __range42_push_sse__?: (id: string, data: string) => void }
          w.__range42_push_sse__?.(id, data)
        },
        [deploymentId, JSON.stringify(event)] as const,
      )
    },
    async pushEvents(deploymentId, events) {
      for (const ev of events) {
        await page.evaluate(
          ([id, data]) => {
            const w = window as unknown as { __range42_push_sse__?: (id: string, data: string) => void }
            w.__range42_push_sse__?.(id, data)
          },
          [deploymentId, JSON.stringify(ev)] as const,
        )
      }
    },
    async closeStream(deploymentId) {
      await page.evaluate((id) => {
        const w = window as unknown as { __range42_close_sse__?: (id: string) => void }
        w.__range42_close_sse__?.(id)
      }, deploymentId)
    },
    getPosts(urlSubstr) {
      return state.postedBodies.filter((p) => p.url.includes(urlSubstr))
    },
    async waitForPost(urlSubstr, timeoutMs = 5000) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const hit = state.postedBodies.find((p) => p.url.includes(urlSubstr))
        if (hit) return hit
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error(`Timed out waiting for POST matching "${urlSubstr}"`)
    },
    async getSseOpenedUrls() {
      return page.evaluate(() => {
        const w = window as unknown as { __range42_opened_sse_urls__?: () => string[] }
        return w.__range42_opened_sse_urls__?.() ?? []
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Seeding helpers — write localStorage before navigation so app boots ready.
// ---------------------------------------------------------------------------

export interface SeedOptions {
  projects?: Array<{
    id: string
    name: string
    nodes?: unknown[]
    edges?: unknown[]
    gamenet?: boolean
    catalog_sha?: string
    project_sha?: string
    [key: string]: unknown
  }>
  sources?: Array<Record<string, unknown>>
  proxmoxSettings?: Record<string, unknown>
  migrationDone?: boolean
}

/** Stage localStorage before page navigation so Home skips the setup checklist. */
export async function seedLocalStorage(page: Page, opts: SeedOptions): Promise<void> {
  await page.addInitScript((data) => {
    try {
      if (data.projects) localStorage.setItem('range42_projects', JSON.stringify(data.projects))
      if (data.sources) localStorage.setItem('range42_git_sources', JSON.stringify(data.sources))
      if (data.proxmoxSettings) {
        localStorage.setItem('range42_proxmox_settings', JSON.stringify(data.proxmoxSettings))
      }
      if (data.migrationDone) {
        localStorage.setItem('range42_migration_v1_done', '1')
      }
    } catch { /* ignore */ }
  }, opts)
}

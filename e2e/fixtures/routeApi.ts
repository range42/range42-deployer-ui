import type { Page } from '@playwright/test'
import { setupMockApi } from './mockApi'

export const routeProject = { id: 'route-project', name: 'Route project', nodes: [], edges: [],
  files: { 'notes.txt': 'Keep these local bytes.' }, created: '2026-09-14T08:00:00Z', modified: '2026-09-14T08:00:00Z' }
export const routeEntry = { name: 'service.reload.ntp', kind: 'ansible_role', source_id: 'catalog',
  path: '02_ansible_layer/admin/roles/service.reload.ntp', sha: 'a'.repeat(40), document: {}, readme_md: '# NTP role' }
export const routeEntryUrl = `/catalog/catalog/${encodeURIComponent(routeEntry.path)}`
export const routeSource = { id: 'catalog', name: 'Default catalog', provider: 'github', base_url: 'https://github.com',
  auth: { kind: 'none' }, repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }], writable: false }
const deployment = { id: 'route-deployment', codename: 'ROUTE_REVIEW', scenario_label: 'route_lab',
  state: 'failed', project_id: 'backend-project', project_sha: 'b'.repeat(40), attempts_count: 0 }

/** Local browser acceptance only. Every API/provider call is intercepted; writes are refused. */
export async function routeApi(page: Page, projects: Array<{ id: string; name: string; nodes: unknown[]; edges: unknown[]; [key: string]: unknown }> = [routeProject]) {
  const state = { status: 200, catalog: [routeEntry], sources: [routeSource], deployments: [deployment],
    preflightStatus: 200, providerStatus: 403, proxmoxReady: true,
    reads: [] as string[], writes: [] as string[], unexpected: [] as string[] }
  const held = new Map<string, Promise<void>>()
  await page.addInitScript(({ projects, source }) => {
    if (localStorage.getItem('route-fixture-seeded')) return
    localStorage.setItem('range42_projects', JSON.stringify(projects))
    localStorage.setItem('range42_git_sources', JSON.stringify([{ ...source, backend_url: location.origin }]))
    localStorage.setItem('range42_backend_api', JSON.stringify({ hosts: [{ id: 'backend', url: location.origin,
      label: 'Controlled backend', token: 'route-fixture-token', health: { status: 'ok', ready: true } }], activeHostId: 'backend', seeded: true }))
    localStorage.setItem('range42_migration_v1_done', '1')
    localStorage.setItem('route-fixture-seeded', '1')
  }, { projects, source: routeSource })
  await setupMockApi(page) // Reuse its controllable SSE transport; override its older REST fixtures below.
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    const api = url.pathname.startsWith('/v1/') || url.pathname.startsWith('/v0/') || url.pathname === '/health'
    const provider = url.hostname === 'api.github.com'
    if (!api && !provider) {
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
      state.unexpected.push(request.url())
      return route.abort()
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      state.writes.push(`${request.method()} ${url.pathname}`)
      return route.fulfill({ status: 405, json: { code: 'FIXTURE_READ_ONLY', message: 'This browser check refuses mutations.' } })
    }
    state.reads.push(url.pathname)
    if (provider) return route.fulfill({ status: state.providerStatus, json: { message: 'Fixture destination access refused. Check repository permissions.' } })
    if (held.has(url.pathname)) await held.get(url.pathname)
    if (url.pathname === '/v1/health/ready') return route.fulfill({ json: { ready: state.proxmoxReady, checks: {
      sqlite_wal: { ok: true }, workspace_writable: { ok: true }, proxmox: { ok: state.proxmoxReady },
      git: { ok: null, required: false, connectivity: 'not_checked', sources_registered: 2 },
    } } })
    if (url.pathname === '/health' || url.pathname === '/v1/health') return route.fulfill({ json: { status: 'ok' } })
    if (state.status !== 200) return route.fulfill({ status: state.status,
      json: { code: state.status === 401 ? 'AUTH_REQUIRED' : 'FIXTURE_UNAVAILABLE', message: 'Fixture unavailable. Retry the request.' } })
    const pageOf = (items: unknown[]) => ({ items, total: items.length, offset: 0, limit: 100 })
    if (url.pathname === '/v1/auth/me') return route.fulfill({ json: { actor_id: 'fixture-operator', role: 'operator', scope: 'installation', audit_enabled: false } })
    if (url.pathname === '/v1/admin/retention') return route.fulfill({ json: { keep_count: 5, keep_days: 7, automatic_enforcement: false, execution: 'reviewed_snapshot_sets_only' } })
    if (url.pathname === '/v1/catalog/sources') return route.fulfill({ json: pageOf(state.sources) })
    if (url.pathname === '/v1/catalog/entries') return route.fulfill({ json: pageOf(state.catalog) })
    if (url.pathname.startsWith('/v1/catalog/entries/catalog/')) {
      const entry = state.catalog.find(item => item.path === decodeURIComponent(url.pathname.slice('/v1/catalog/entries/catalog/'.length)))
      return route.fulfill({ status: entry ? 200 : 404, json: entry || { code: 'CATALOG_ENTRY_NOT_FOUND' } })
    }
    if (url.pathname === '/v1/proxmox/hosts') return route.fulfill({ json: pageOf([]) })
    if (url.pathname === '/v1/proxmox/runtime-capabilities') return route.fulfill({ json: {
      version: 1, available: false, bootstrap_features: [], operations: [], management_access_available: false,
    } })
    if (url.pathname === '/v1/deployments') return route.fulfill({ json: pageOf(state.deployments) })
    if (url.pathname.endsWith('/preflight')) return route.fulfill({ status: state.preflightStatus, json: state.preflightStatus === 200
      ? { result: 'block', blocking: true, checks: [{ check: 'git_revision', result: 'block', detail: 'Review this saved revision before starting.' }], ts: '2026-09-14T08:00:00Z' }
      : { code: 'PREFLIGHT_NOT_FOUND', message: 'No saved preflight report.' } })
    if (url.pathname.endsWith('/allocations')) return route.fulfill({ status: 404, json: { code: 'ALLOCATION_NOT_FOUND', message: 'No deployment allocation claim.' } })
    if (url.pathname.endsWith('/runtime')) return route.fulfill({ json: { firewall: { datacenter_enabled: null, node_enabled: null, errors: [] },
      sdn: { pending_changes: null, errors: [] }, vms: [], networks: [], runtime: { available: false, reason: 'No owned guests in this fixture.' } } })
    if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: '' })
    if (url.pathname.endsWith('/snapshot-sets')) return route.fulfill({ json: pageOf([]) })
    if (url.pathname.endsWith('/attempts') || url.pathname.endsWith('/snapshots')) return route.fulfill({ json: [] })
    if (url.pathname === '/v1/deployments/route-deployment') return route.fulfill({ json: deployment })
    state.unexpected.push(url.pathname)
    return route.fulfill({ status: 404, json: { code: 'FIXTURE_UNMATCHED', message: 'Unexpected fixture read.' } })
  })
  return { state, hold(path: string) {
    let release!: () => void
    held.set(path, new Promise<void>(resolve => { release = resolve }))
    return () => { held.delete(path); release() }
  } }
}

/**
 * Backend API host registry.
 *
 * The deployer-ui talks to backend-api instances — the backend is the component
 * that holds Proxmox credentials and connects to hypervisors; the UI never talks
 * to Proxmox directly. The user can register SEVERAL backend-api hosts, each one
 * paired with the single Proxmox node it targets ("should be 1" node per host).
 * A project then selects exactly one of these hosts (see useProxmoxSettings).
 *
 * Each host:
 *   - `id`        — stable local id
 *   - `label`     — human label (defaults to the URL)
 *   - `url`       — base URL of the backend API (e.g. http://192.168.142.121:8000)
 *   - `token`     — bearer token required by secured backend installations
 *   - `nodeName`  — the Proxmox node this backend deploys to (e.g. pve)
 *   - `health`    — last health-probe result
 *
 * One host is the `active` host (used by app-level reads such as snapshot
 * retention that aren't scoped to a project). Persists to localStorage under
 * `range42_backend_api`. Legacy single-config payloads ({ url, token, health })
 * are migrated into a one-host list on first load.
 *
 * Proxmox host CRUD is NOT in the UI — the backend owns it. The UI reads
 * `/v1/proxmox/hosts` read-only from the configured backend to populate pickers.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { RuntimeConfig } from '@/services/runtimeConfig.ts'

const STORAGE_KEY = 'range42_backend_api'
const DEFAULT_NODE = 'pve'

export interface BackendApiHealth {
  status: 'ok' | 'degraded' | 'unreachable' | 'unauthorized' | 'forbidden'
  rtt_ms?: number
  backend_version?: string
  ready?: boolean
  checks?: Record<string, { ok: boolean; [k: string]: unknown }>
  ts: string
}

export interface BackendApiHost {
  id: string
  label: string
  url: string
  token?: string
  nodeName: string
  health?: BackendApiHealth
}

interface BackendApiState {
  hosts: BackendApiHost[]
  activeHostId: string | null
  /**
   * Whether the deployment's `config.json` default has already been offered.
   * Sticky, so deleting the seeded host stays deleted across reloads instead
   * of being re-added on every boot.
   */
  seeded?: boolean
}

/** Counter-free local id (Date.now/Math.random are fine in the browser runtime). */
function newId(): string {
  return `host_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '')
}

function loadState(): BackendApiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      // New format
      if (parsed && Array.isArray(parsed.hosts)) {
        const hosts: BackendApiHost[] = parsed.hosts
          .filter((h: { url?: unknown }) => h && typeof h.url === 'string')
          .map((h: Partial<BackendApiHost>) => ({
            id: h.id || newId(),
            label: h.label || normalizeUrl(h.url as string),
            url: normalizeUrl(h.url as string),
            token: h.token || undefined,
            nodeName: h.nodeName || DEFAULT_NODE,
            health: h.health,
          }))
        const activeHostId =
          parsed.activeHostId && hosts.some((h) => h.id === parsed.activeHostId)
            ? parsed.activeHostId
            : hosts[0]?.id ?? null
        return { hosts, activeHostId, seeded: Boolean(parsed.seeded) }
      }
      // Legacy single-config { url, token, health } → migrate into one host
      if (parsed && typeof parsed.url === 'string') {
        const id = newId()
        return {
          hosts: [
            {
              id,
              label: normalizeUrl(parsed.url),
              url: normalizeUrl(parsed.url),
              token: parsed.token || undefined,
              nodeName: DEFAULT_NODE,
              health: parsed.health,
            },
          ],
          activeHostId: id,
          seeded: true,
        }
      }
    }
  } catch (e) {
    console.warn('[backendApiStore] Failed to load state:', e)
  }
  return { hosts: [], activeHostId: null }
}

export const useBackendApiStore = defineStore('backendApi', () => {
  const state = ref<BackendApiState>(loadState())

  const hosts = computed(() => state.value.hosts)
  const activeHost = computed<BackendApiHost | null>(
    () => state.value.hosts.find((h) => h.id === state.value.activeHostId) ?? null,
  )

  // Back-compat getters — resolve against the active host so existing callers
  // (snapshot retention, etc.) keep working.
  const url = computed(() => activeHost.value?.url ?? '')
  const token = computed(() => activeHost.value?.token)
  const health = computed(() => activeHost.value?.health)
  const isHealthy = computed(() => activeHost.value?.health?.status === 'ok')
  const requiresAuthentication = computed(() => health.value?.status === 'unauthorized')

  watch(
    state,
    (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch (e) {
        console.warn('[backendApiStore] Failed to save state:', e)
      }
    },
    { deep: true, flush: 'sync' },
  )

  function getHost(id: string): BackendApiHost | null {
    return state.value.hosts.find((h) => h.id === id) ?? null
  }

  function addHost(input: {
    label?: string
    url: string
    token?: string
    nodeName?: string
  }): string {
    const id = newId()
    const cleanUrl = normalizeUrl(input.url)
    state.value.hosts.push({
      id,
      label: (input.label || '').trim() || cleanUrl,
      url: cleanUrl,
      token: input.token && input.token.length ? input.token : undefined,
      nodeName: (input.nodeName || '').trim() || DEFAULT_NODE,
    })
    if (!state.value.activeHostId) state.value.activeHostId = id
    return id
  }

  function updateHost(
    id: string,
    patch: Partial<Omit<BackendApiHost, 'id'>>,
  ): void {
    const host = state.value.hosts.find((h) => h.id === id)
    if (!host) return
    if ((patch.url !== undefined && normalizeUrl(patch.url) !== host.url) ||
        (patch.token !== undefined && (patch.token || undefined) !== host.token)) host.health = undefined
    if (patch.url !== undefined) host.url = normalizeUrl(patch.url)
    if (patch.label !== undefined) host.label = patch.label.trim() || host.url
    if (patch.token !== undefined) host.token = patch.token || undefined
    if (patch.nodeName !== undefined) host.nodeName = patch.nodeName.trim() || DEFAULT_NODE
    if (patch.health !== undefined) host.health = patch.health
  }

  function removeHost(id: string): void {
    state.value.hosts = state.value.hosts.filter((h) => h.id !== id)
    if (state.value.activeHostId === id) {
      state.value.activeHostId = state.value.hosts[0]?.id ?? null
    }
  }

  function setActiveHost(id: string): void {
    if (state.value.hosts.some((h) => h.id === id)) {
      state.value.activeHostId = id
    }
  }

  // Back-compat mutators — operate on the active host, creating one if needed.
  function setUrl(next: string): void {
    if (activeHost.value) {
      updateHost(activeHost.value.id, { url: next })
    } else {
      addHost({ url: next })
    }
  }

  function setToken(next: string | undefined): void {
    if (activeHost.value) updateHost(activeHost.value.id, { token: next })
  }

  function clear(): void {
    state.value = { hosts: [], activeHostId: null }
  }

  /**
   * Register the backend the deployment shipped in its `config.json`, so a
   * freshly deployed lab is usable without the operator retyping the URL.
   *
   * No-op once the operator has made a choice — either a host is already
   * registered, or the default was offered before and dismissed. Their
   * configuration always wins over the deployment's.
   */
  function seedDefaultHost(config: RuntimeConfig | null | undefined): void {
    if (state.value.seeded || state.value.hosts.length) return
    const url = normalizeUrl(config?.defaultBackendUrl ?? '')
    if (!url) return
    addHost({ url, nodeName: config?.defaultNodeName })
    state.value.seeded = true
  }

  function authHeaders(id?: string): Record<string, string> {
    const host = id ? getHost(id) : activeHost.value
    return host?.token ? { Authorization: `Bearer ${host.token}` } : {}
  }

  function recordAuthFailure(id: string, url: string, token?: string): void {
    const host = getHost(id)
    if (host?.url === url && host.token === token) {
      updateHost(id, { health: { status: 'unauthorized', ts: new Date().toISOString() } })
    }
  }

  async function connectToken(candidate: string): Promise<void> {
    const host = activeHost.value
    if (!host) throw new Error('Select a backend before connecting.')
    const token = candidate.trim()
    if (!token) throw new Error('Enter the backend API token.')
    const snapshot = { id: host.id, url: host.url, token: host.token }
    const start = performance.now()
    const res = await fetch(`${host.url}/v1/health/ready`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    if (res.status === 401) throw new Error('The backend API token was rejected. Check it and try again.')
    if (res.status === 403) throw new Error('This token does not have access to the backend.')
    if (!res.ok) throw new Error(`Could not verify the backend connection (HTTP ${res.status}).`)
    const body = await res.json()
    if (typeof body?.ready !== 'boolean') throw new Error('The server did not return a backend readiness result.')
    if (activeHost.value?.id !== snapshot.id || host.url !== snapshot.url || host.token !== snapshot.token) {
      throw new Error('The backend connection changed. Try again for the selected backend.')
    }
    updateHost(host.id, { token, health: {
      status: body.ready ? 'ok' : 'degraded', ready: body.ready, checks: body.checks,
      rtt_ms: Math.round(performance.now() - start), ts: new Date().toISOString(),
    } })
  }

  /**
   * Probe a host's readiness. Hits `/v1/health/ready` and records the structured
   * result on that host. Defaults to the active host.
   */
  async function testConnection(id?: string): Promise<BackendApiHealth> {
    const host = id ? getHost(id) : activeHost.value
    const ts = new Date().toISOString()
    if (!host) {
      return { status: 'unreachable', ts }
    }
    const base = normalizeUrl(host.url)
    const originalToken = host.token
    const record = (next: BackendApiHealth) => {
      if (getHost(host.id)?.url === base && getHost(host.id)?.token === originalToken) updateHost(host.id, { health: next })
      return next
    }
    const start = performance.now()
    try {
      const res = await fetch(`${base}/v1/health/ready`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders(host.id) },
        signal: AbortSignal.timeout(10000),
      })
      const rtt_ms = Math.round(performance.now() - start)
      if (!res.ok) {
        return record({ status: res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'degraded', rtt_ms, ts })
      }
      const body = await res.json().catch(() => ({}))
      const next: BackendApiHealth = {
        status: body?.ready ? 'ok' : 'degraded',
        rtt_ms,
        ready: Boolean(body?.ready),
        checks: body?.checks,
        ts,
      }
      return record(next)
    } catch {
      const rtt_ms = Math.round(performance.now() - start)
      const next: BackendApiHealth = { status: 'unreachable', rtt_ms, ts }
      return record(next)
    }
  }

  return {
    // list state
    hosts,
    activeHost,
    // back-compat getters
    url,
    token,
    health,
    isHealthy,
    requiresAuthentication,
    // list ops
    getHost,
    seedDefaultHost,
    addHost,
    updateHost,
    removeHost,
    setActiveHost,
    // back-compat mutators
    setUrl,
    setToken,
    clear,
    authHeaders,
    testConnection,
    connectToken,
    recordAuthFailure,
  }
})

export default useBackendApiStore

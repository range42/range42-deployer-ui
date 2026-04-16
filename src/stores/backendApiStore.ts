/**
 * Backend API connection settings.
 *
 * The deployer-ui talks to exactly ONE backend-api instance at a time. The backend
 * is the component that holds Proxmox credentials and connects to hypervisors —
 * the UI never talks to Proxmox directly. This store manages:
 *
 *   - `url`      — base URL of the backend API (e.g. http://192.168.142.121:8000)
 *   - `token`    — optional bearer token for when Kong lands upstream (today unused)
 *   - `health`   — last health-probe result (status, rtt_ms, ts)
 *
 * Persists to localStorage under `range42_backend_api`. The vite build-time
 * `VITE_API_URL` remains the default fallback for the very first load.
 *
 * Proxmox host CRUD is NOT in the UI — the backend owns it (via its own
 * env/config/admin tooling). The UI reads `/v1/proxmox/hosts` from the configured
 * backend to populate pickers but never POSTs/DELETEs.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

const STORAGE_KEY = 'range42_backend_api'

export interface BackendApiHealth {
  status: 'ok' | 'degraded' | 'unreachable'
  rtt_ms?: number
  backend_version?: string
  ready?: boolean
  checks?: Record<string, { ok: boolean; [k: string]: unknown }>
  ts: string
}

export interface BackendApiConfig {
  url: string
  token?: string
  health?: BackendApiHealth
}

const DEFAULT_CONFIG: BackendApiConfig = {
  url: (import.meta.env?.VITE_API_URL as string) || 'http://127.0.0.1:8000',
  token: undefined,
  health: undefined,
}

function loadConfig(): BackendApiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.url === 'string') {
        return { ...DEFAULT_CONFIG, ...parsed }
      }
    }
  } catch (e) {
    console.warn('[backendApiStore] Failed to load config:', e)
  }
  return { ...DEFAULT_CONFIG }
}

export const useBackendApiStore = defineStore('backendApi', () => {
  const config = ref<BackendApiConfig>(loadConfig())

  const url = computed(() => config.value.url)
  const token = computed(() => config.value.token)
  const health = computed(() => config.value.health)
  const isHealthy = computed(() => config.value.health?.status === 'ok')

  watch(
    config,
    (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch (e) {
        console.warn('[backendApiStore] Failed to save config:', e)
      }
    },
    { deep: true },
  )

  function setUrl(next: string) {
    config.value.url = next.replace(/\/+$/, '')
  }

  function setToken(next: string | undefined) {
    config.value.token = next && next.length ? next : undefined
  }

  function clear() {
    config.value = { ...DEFAULT_CONFIG, health: undefined }
  }

  function authHeaders(): Record<string, string> {
    return config.value.token ? { Authorization: `Bearer ${config.value.token}` } : {}
  }

  /**
   * Probe the backend's readiness. Hits `/v1/health/ready` and records the
   * structured result in `config.health`.
   */
  async function testConnection(): Promise<BackendApiHealth> {
    const base = config.value.url.replace(/\/+$/, '')
    const ts = new Date().toISOString()
    const start = performance.now()
    try {
      const res = await fetch(`${base}/v1/health/ready`, {
        method: 'GET',
        headers: { Accept: 'application/json', ...authHeaders() },
      })
      const rtt_ms = Math.round(performance.now() - start)
      if (!res.ok) {
        const next: BackendApiHealth = { status: 'degraded', rtt_ms, ts }
        config.value.health = next
        return next
      }
      const body = await res.json().catch(() => ({}))
      const next: BackendApiHealth = {
        status: body?.ready ? 'ok' : 'degraded',
        rtt_ms,
        ready: Boolean(body?.ready),
        checks: body?.checks,
        ts,
      }
      config.value.health = next
      return next
    } catch {
      const rtt_ms = Math.round(performance.now() - start)
      const next: BackendApiHealth = { status: 'unreachable', rtt_ms, ts }
      config.value.health = next
      return next
    }
  }

  return {
    config,
    url,
    token,
    health,
    isHealthy,
    setUrl,
    setToken,
    clear,
    authHeaders,
    testConnection,
  }
})

export default useBackendApiStore

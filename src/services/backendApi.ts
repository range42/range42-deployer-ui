import { useBackendApiStore } from '@/stores/backendApiStore'

/** Catalog records belong to the backend that registered them. */
export function getBackendScope(): string {
  return useBackendApiStore().url.replace(/\/+$/, '')
}

export class BackendApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
    this.name = 'BackendApiError'
  }
}

/** App-level v1 requests use the selected backend and its gateway credentials. */
export async function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/v1/')) throw new Error('Expected a v1 API path')
  const backend = useBackendApiStore()
  const host = backend.activeHost ? { ...backend.activeHost } : null
  const headers = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...Object.fromEntries(new Headers(init.headers).entries()),
    ...backend.authHeaders(),
  }
  const response = await fetch(`${getBackendScope()}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  })
  if (!response.ok) {
    if (response.status === 401 && host) backend.recordAuthFailure(host.id, host.url, host.token)
    const body = await response.json().catch(() => null)
    throw new BackendApiError(
      response.status === 401 ? 'Connect with your backend API token to continue.' : body?.message || `Backend request failed (${response.status})`,
      response.status,
      body?.code,
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

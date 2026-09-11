import { useBackendApiStore } from '@/stores/backendApiStore'

/** Catalog records belong to the backend that registered them. */
export function getBackendScope(): string {
  return useBackendApiStore().url.replace(/\/+$/, '')
}

export class BackendApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details: Array<{ field: string; reason: string }> = []) {
    super(message)
    this.name = 'BackendApiError'
  }
}

/** App-level v1 requests use the selected backend and its gateway credentials. */
async function backendResponse(path: string, init: RequestInit = {}): Promise<Response> {
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
      Array.isArray(body?.details) ? body.details
        .filter((detail: unknown): detail is { field: string; reason: string } => !!detail && typeof detail === 'object'
          && 'field' in detail && typeof detail.field === 'string' && 'reason' in detail && typeof detail.reason === 'string')
        .map(({ field, reason }: { field: string; reason: string }) => ({ field, reason })) : [],
    )
  }
  return response
}

export async function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await backendResponse(path, init)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function backendBlob(path: string): Promise<Blob> {
  return (await backendResponse(path)).blob()
}

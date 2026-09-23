<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useBackendApiStore } from '@/stores/backendApiStore'

interface Identity { actor_id: string; role: 'admin' | 'operator' | 'viewer'; scope: 'installation'; audit_enabled: boolean }
interface AuditRow { id: string; actor_id: string; role: string; method: string; route: string; state: string; status_code: number | null; created_at: string }
const backend = useBackendApiStore()
const identity = ref<Identity | null>(null), rows = ref<AuditRow[]>([]), total = ref(0), offset = ref(0)
const busy = ref(false), error = ref(''), loaded = ref(false)
let generation = 0, controller: AbortController | null = null
function clear() {
  generation++; controller?.abort(); controller = null
  identity.value = null; rows.value = []; total.value = 0; offset.value = 0; error.value = ''; loaded.value = false; busy.value = false
}
watch(() => [backend.activeHost?.id, backend.url, backend.token], clear, { flush: 'sync' })
onUnmounted(clear)
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The backend returned an invalid access response.')
  return value as Record<string, unknown>
}
function parseIdentity(value: unknown): Identity {
  const row = object(value)
  if (typeof row.actor_id !== 'string' || !['admin', 'operator', 'viewer'].includes(String(row.role)) || row.scope !== 'installation' || typeof row.audit_enabled !== 'boolean') throw new Error('The backend returned an invalid identity.')
  return row as unknown as Identity
}
function parseAudit(value: unknown): { items: AuditRow[]; total: number } {
  const page = object(value)
  if (!Number.isSafeInteger(page.total) || Number(page.total) < 0 || !Array.isArray(page.items) || page.items.length > 50) throw new Error('The backend returned an invalid audit page.')
  const items = page.items.map(value => {
    const row = object(value)
    if (['id', 'actor_id', 'role', 'method', 'route', 'state', 'created_at'].some(key => typeof row[key] !== 'string') || (row.status_code !== null && !Number.isInteger(row.status_code))) throw new Error('The backend returned an invalid audit record.')
    return row as unknown as AuditRow
  })
  return { items, total: Number(page.total) }
}
async function request(path: string, apply: (value: unknown) => void) {
  if (!backend.url || busy.value) return
  const current = generation, url = backend.url, headers = { ...backend.authHeaders(), Accept: 'application/json' }
  controller = new AbortController()
  const active = controller, timer = setTimeout(() => active.abort(), 15000)
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`${url}/v1/${path}`, { headers, signal: active.signal })
    if (!response.ok) throw new Error(response.status === 401 ? 'A valid backend API token is required.' : response.status === 403 ? 'Access denied by the backend role.' : response.status === 404 ? 'This backend does not provide access readback yet.' : 'Backend access information is unavailable.')
    const value: unknown = await response.json()
    if (current === generation) apply(value)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Backend access request timed out. Retry when the backend is reachable.'
  } finally {
    clearTimeout(timer)
    if (current === generation) { busy.value = false; controller = null }
  }
}
function checkAccess() {
  identity.value = null; rows.value = []; total.value = 0; offset.value = 0; loaded.value = false
  return request('auth/me', value => { identity.value = parseIdentity(value) })
}
function loadAudit(reset = false) {
  if (identity.value?.role !== 'admin') return
  const start = reset ? 0 : offset.value
  return request(`admin/audit?offset=${start}&limit=50`, value => {
    const page = parseAudit(value), prior = reset ? [] : rows.value, ids = new Set(prior.map(row => row.id))
    rows.value = [...prior, ...page.items.filter(row => !ids.has(row.id))]
    offset.value = start + page.items.length; total.value = page.total; loaded.value = true
  })
}
</script>

<template>
  <section class="rounded-xl border border-base-300 p-4 my-4" data-testid="backend-access-panel" aria-labelledby="backend-access-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 id="backend-access-title" class="font-semibold">Backend identity and access</h3>
      <button type="button" class="btn btn-outline btn-sm" data-testid="check-access" :disabled="!backend.url || busy" @click="checkAccess">Check backend access</button>
    </div>
    <p class="text-sm text-base-content/65 mt-2">The active backend token determines permissions. Your local display name is used for Git collaboration.</p>
    <p v-if="error" class="text-error text-sm mt-3" role="alert">{{ error }}</p>
    <div v-if="identity" class="mt-3 space-y-2">
      <p><span class="font-mono">{{ identity.actor_id }}</span> <span class="badge badge-outline ml-2">{{ identity.role }}</span></p>
      <p class="text-sm text-base-content/70">Permissions apply across this backend installation. {{ identity.role === 'viewer' ? 'Read-only access; guest configuration and mutations are restricted.' : identity.role === 'operator' ? 'Project and deployment operations are allowed. Host registration, credentials and administration require an administrator.' : 'Administrator access.' }}</p>
      <p class="text-sm">Mutation audit: {{ identity.audit_enabled ? 'enabled' : 'disabled' }}</p>
      <template v-if="identity.role === 'admin'">
        <button type="button" class="btn btn-outline btn-sm" data-testid="load-audit" :disabled="busy" @click="loadAudit(true)">Refresh mutation audit</button>
        <p class="text-xs text-base-content/65">Records show request outcomes. An unfinished record needs investigation; an accepted request does not prove guest execution succeeded.</p>
        <div v-if="rows.length" class="overflow-x-auto max-h-96">
          <table class="table table-sm">
            <thead><tr><th>Time</th><th>Actor</th><th>Operation</th><th>Outcome</th></tr></thead>
            <tbody><tr v-for="row in rows" :key="row.id" data-testid="audit-row">
              <td class="whitespace-nowrap">{{ new Date(row.created_at).toLocaleString() }}</td><td>{{ row.actor_id }}<span class="text-xs text-base-content/60 block">{{ row.role }}</span></td>
              <td class="font-mono text-xs break-all">{{ row.method }} {{ row.route }}</td><td>{{ row.state }} {{ row.status_code ?? '' }}</td>
            </tr></tbody>
          </table>
        </div>
        <p v-else-if="loaded" class="text-sm text-base-content/65">No mutation audit records.</p>
        <button v-if="loaded && offset < total" type="button" class="btn btn-ghost btn-sm" data-testid="more-audit" :disabled="busy" @click="loadAudit()">Load more audit records</button>
      </template>
    </div>
  </section>
</template>

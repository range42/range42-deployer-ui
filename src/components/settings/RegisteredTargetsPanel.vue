<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useBackendApiStore, type BackendApiHost } from '@/stores/backendApiStore'

interface Target { id: string; name: string; api_url: string; node_name: string; has_token: boolean; default_bridge: string }
interface Health { status: 'ok' | 'degraded' | 'unreachable'; rtt_ms: number | null; sdn_available: boolean | null }
const props = defineProps<{ profileId: string }>()
const backend = useBackendApiStore()
const profile = computed(() => backend.getHost(props.profileId))
const targets = ref<Target[]>([]), health = ref<Record<string, Health>>({})
const busy = ref(false), loaded = ref(false), error = ref(''), notice = ref(''), testingId = ref('')
const defaultMissing = computed(() => loaded.value && targets.value.length > 0 && !targets.value.some(row => row.node_name === profile.value?.nodeName))
let generation = 0, requested = false, controller: AbortController | null = null

function reset() {
  generation++; controller?.abort(); controller = null
  targets.value = []; health.value = {}; busy.value = false; loaded.value = false
  error.value = ''; notice.value = ''; testingId.value = ''
}
watch(() => JSON.stringify([props.profileId, profile.value?.url, profile.value?.token]), () => {
  reset()
  const current = generation
  // Invalidate immediately, but let a complete URL/token update settle before
  // sending credentials. Legacy setters may update both in the same turn.
  if (requested) void nextTick(() => {
    if (current === generation && profile.value) void loadTargets()
  })
}, { flush: 'sync' })
onUnmounted(reset)

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The backend returned an invalid target response.')
  return value as Record<string, unknown>
}
function parseTarget(value: unknown): Target {
  const row = object(value)
  if (['id', 'name', 'api_url', 'node_name', 'default_bridge'].some(key => typeof row[key] !== 'string' || !(row[key] as string).trim()) || typeof row.has_token !== 'boolean') throw new Error('The backend returned an incomplete target registration.')
  let url: URL
  try { url = new URL(row.api_url as string) } catch { throw new Error('The backend returned an invalid target address.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('The backend returned an invalid target address.')
  return { id: row.id as string, name: row.name as string, api_url: url.origin, node_name: row.node_name as string, has_token: row.has_token, default_bridge: row.default_bridge as string }
}
function parseHealth(value: unknown): Health {
  const row = object(value)
  if (!['ok', 'degraded', 'unreachable'].includes(String(row.status))
    || (row.rtt_ms !== null && (!Number.isSafeInteger(row.rtt_ms) || Number(row.rtt_ms) < 0))
    || (row.sdn_available !== null && typeof row.sdn_available !== 'boolean')) throw new Error('The backend returned an invalid target health result.')
  return { status: row.status as Health['status'], rtt_ms: row.rtt_ms as number | null, sdn_available: row.sdn_available as boolean | null }
}
async function read(snapshot: BackendApiHost, path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${snapshot.url}${path}`, {
    method: 'GET', credentials: 'same-origin', signal,
    headers: { Accept: 'application/json', ...(snapshot.token ? { Authorization: `Bearer ${snapshot.token}` } : {}) },
  })
  if (!response.ok) throw new Error(response.status === 401
    ? 'Authentication failed. Check the backend API token and the registered Proxmox credentials.'
    : response.status === 403 ? 'Access denied. Check the backend role and Proxmox permissions.'
      : 'Registered target information is unavailable. Check the backend and retry.')
  try { return await response.json() } catch { throw new Error('The backend returned an invalid target response.') }
}
async function request<T>(readValue: (snapshot: BackendApiHost, signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
  if (!profile.value?.url || busy.value) return
  const current = generation, snapshot = { ...profile.value }
  const active = new AbortController(), timer = setTimeout(() => active.abort(), 15000)
  controller = active; busy.value = true; error.value = ''; notice.value = ''
  try {
    const value = await readValue(snapshot, active.signal)
    if (current === generation) apply(value)
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error && !(cause instanceof TypeError) && cause.name !== 'AbortError'
      ? cause.message : 'Target request timed out or the backend is unreachable. Retry when it is available.'
  } finally {
    clearTimeout(timer)
    if (current === generation) { busy.value = false; controller = null; testingId.value = '' }
  }
}
function loadTargets() {
  if (busy.value) return
  requested = true; targets.value = []; health.value = {}; loaded.value = false
  return request(async (snapshot, signal) => {
    const result: Target[] = [], ids = new Set<string>()
    let total: number | undefined
    do {
      const offset = result.length, page = object(await read(snapshot, `/v1/proxmox/hosts?offset=${offset}&limit=100`, signal))
      if (!Number.isSafeInteger(page.total) || Number(page.total) < 0 || !Array.isArray(page.items) || page.items.length > 100
        || page.offset !== offset || page.limit !== 100 || (total !== undefined && total !== page.total)) throw new Error('The target registry is incomplete or changed while loading. Refresh and try again.')
      total = Number(page.total)
      if (total > 1000) throw new Error('This view supports up to 1,000 registered targets. Ask the backend operator to review this registry.')
      if ((!page.items.length && offset < total) || offset + page.items.length > total) throw new Error('The target registry is incomplete or changed while loading. Refresh and try again.')
      for (const value of page.items) {
        const target = parseTarget(value)
        if (ids.has(target.id)) throw new Error('The target registry changed while loading. Refresh and try again.')
        ids.add(target.id); result.push(target)
      }
    } while (result.length < total)
    return result
  }, result => { targets.value = result; loaded.value = true })
}
function testTarget(target: Target) {
  if (busy.value) return
  testingId.value = target.id; delete health.value[target.id]
  return request(async (snapshot, signal) => parseHealth(await read(snapshot, `/v1/proxmox/hosts/${encodeURIComponent(target.id)}/health`, signal)), result => { health.value[target.id] = result })
}
function ambiguous(target: Target) { return targets.value.filter(row => row.node_name === target.node_name).length !== 1 }
function useNode(target: Target) {
  if (!profile.value || busy.value || !loaded.value || ambiguous(target)) return
  backend.updateHost(props.profileId, { nodeName: target.node_name })
  notice.value = `Profile default set to ${target.node_name}. Existing projects keep their saved target.`
}
</script>

<template>
  <section class="rounded-xl border border-base-300 p-4 space-y-4" aria-labelledby="registered-targets-title" data-testid="registered-targets-panel">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 id="registered-targets-title" class="font-semibold">Registered Proxmox targets</h3>
        <p class="mt-1 text-sm text-base-content/70">Targets available through this backend connection.</p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-testid="load-targets" :disabled="!profile || busy" @click="loadTargets">
        {{ busy && !testingId ? 'Loading targets…' : loaded ? 'Refresh targets' : 'Load targets' }}
      </button>
    </div>
    <p v-if="!profile" class="text-sm text-base-content/70">Select a backend connection to inspect its registered targets.</p>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-success">{{ notice }}</p>
    <p v-if="defaultMissing" class="text-sm text-warning break-words">The profile default “{{ profile?.nodeName }}” does not match a registered node. Select a default below.</p>
    <p v-if="loaded && !targets.length" class="text-sm text-base-content/70">No Proxmox targets are registered on this backend.</p>
    <ul v-if="targets.length" class="space-y-3">
      <li v-for="target in targets" :key="target.id" class="rounded-lg bg-base-200/60 p-3 min-w-0" data-testid="registered-target">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="font-medium break-words min-w-0">{{ target.name }}</h4>
          <span v-if="profile?.nodeName === target.node_name" class="badge badge-sm badge-outline">Profile default node</span>
        </div>
        <dl class="text-sm mt-2 grid gap-1 min-w-0">
          <div class="flex flex-wrap gap-x-2"><dt class="text-base-content/65">Node</dt><dd class="font-mono break-all">{{ target.node_name }}</dd></div>
          <div class="flex flex-wrap gap-x-2"><dt class="text-base-content/65">API</dt><dd class="break-all">{{ target.api_url }}</dd></div>
          <div class="flex flex-wrap gap-x-2"><dt class="text-base-content/65">Target ID</dt><dd class="font-mono break-all">{{ target.id }}</dd></div>
          <div class="flex flex-wrap gap-x-2"><dt class="text-base-content/65">Credentials</dt><dd>{{ target.has_token ? 'Stored on backend' : 'Not configured' }}</dd></div>
        </dl>
        <p v-if="health[target.id]" class="text-sm mt-2" aria-live="polite">
          {{ health[target.id].status === 'ok' ? 'Reachable' : health[target.id].status === 'degraded' ? 'Degraded' : 'Unreachable' }}<span v-if="health[target.id].rtt_ms !== null"> · {{ health[target.id].rtt_ms }} ms</span>
          <span class="block text-base-content/70">{{ health[target.id].sdn_available === true ? 'SDN API available' : health[target.id].sdn_available === false ? 'SDN API unavailable or access denied' : 'SDN API not checked' }}</span>
        </p>
        <p v-if="ambiguous(target)" class="text-xs text-warning mt-2">Multiple targets use this node name. A node-only profile default cannot distinguish these registrations.</p>
        <div class="flex flex-wrap gap-2 mt-3">
          <button type="button" class="btn btn-ghost btn-sm" data-testid="test-target" :disabled="busy" :aria-label="`Test ${target.name}`" @click="testTarget(target)">{{ testingId === target.id ? 'Testing…' : 'Test target' }}</button>
          <button type="button" class="btn btn-outline btn-sm" data-testid="use-target-node" :disabled="busy || ambiguous(target) || profile?.nodeName === target.node_name" @click="useNode(target)">Use node as profile default</button>
        </div>
      </li>
    </ul>
    <p class="text-xs text-base-content/65">Target tests check API access and update the backend's recorded health. They do not verify guest connectivity or SDN traffic.</p>
    <p class="text-xs text-base-content/65">Registration and credential changes are managed by the backend administrator through its deployment configuration or authenticated host API. This panel changes only the local profile's default node.</p>
  </section>
</template>

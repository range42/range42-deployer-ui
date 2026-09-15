<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

const emit = defineEmits(['dirty'])
const backend = useBackendApiStore()
const { confirm } = useConfirmDialog()
const saved = ref(null), draft = ref(null), role = ref('')
const busy = ref(false), error = ref(''), message = ref('')
const countInput = ref(null), daysInput = ref(null), invalid = ref('')
const dirty = computed(() => !!draft.value && JSON.stringify(saved.value) !== JSON.stringify(draft.value))
watch(dirty, value => emit('dirty', value))
let generation = 0, controller
const identity = () => JSON.stringify([backend.activeHost?.id, backend.url, backend.token])
function policy(value) {
  if (!value || !Number.isInteger(value.keep_count) || value.keep_count < 0 || value.keep_count > 10000 || !Number.isInteger(value.keep_days) || value.keep_days < 0 || value.keep_days > 36500 || value.automatic_enforcement !== false || value.execution !== 'reviewed_snapshot_sets_only') throw new Error('This backend returned an unsupported snapshot retention policy.')
  return { keep_count: value.keep_count, keep_days: value.keep_days }
}
async function request(url, headers, signal, method = 'GET', value) {
  const response = await fetch(url, { method, headers, signal, ...(value ? { body: JSON.stringify(value) } : {}) })
  if (!response.ok) throw new Error(response.status === 401 ? 'Connect with a valid backend API token, then reload.' : response.status === 403 ? method === 'PUT' ? 'Snapshot retention changes require a backend administrator.' : 'Your token lacks access to retention settings. An operator or administrator can read this policy.' : `Backend request failed (HTTP ${response.status}). Reload or try again.`)
  try { return await response.json() } catch { throw new Error('The backend returned an invalid retention response. Reload and try again.') }
}
async function load() {
  const current = ++generation
  controller?.abort(); const active = new AbortController(); controller = active
  const signal = active.signal, scope = identity(), url = backend.url
  saved.value = null; draft.value = null; role.value = ''; error.value = ''; message.value = ''; invalid.value = ''
  if (!url) { busy.value = false; return }
  busy.value = true
  const timer = setTimeout(() => active.abort(), 15000)
  try {
    const headers = { Accept: 'application/json', ...backend.authHeaders() }
    const [value, access] = await Promise.all([
      request(`${url}/v1/admin/retention`, headers, signal),
      request(`${url}/v1/auth/me`, headers, signal),
    ])
    if (current !== generation || identity() !== scope) return
    saved.value = policy(value); draft.value = { ...saved.value }
    role.value = access?.scope === 'installation' && typeof access.actor_id === 'string' ? access.role : ''
  } catch (cause) { if (current === generation) error.value = cause.name === 'AbortError' ? 'The request timed out. Check the backend connection and reload.' : cause.message }
  finally { clearTimeout(timer); if (current === generation) busy.value = false }
}
async function reload() {
  if (dirty.value && !await confirm({ title: 'Discard retention edits?', message: 'Reloading will replace your unsaved changes with the backend policy.', confirmText: 'Reload policy' })) return
  await load()
}
async function save() {
  if (busy.value || role.value !== 'admin' || !draft.value) return
  error.value = ''; message.value = ''; invalid.value = ''
  for (const [field, max, input] of [['keep_count', 10000, countInput], ['keep_days', 36500, daysInput]]) {
    if (!Number.isInteger(draft.value[field]) || draft.value[field] < 0 || draft.value[field] > max) {
      invalid.value = field; error.value = `Enter a whole number between 0 and ${max}.`; input.value?.focus(); return
    }
  }
  const current = generation, scope = identity(), active = new AbortController()
  controller = active; busy.value = true
  const timer = setTimeout(() => active.abort(), 15000)
  try {
    const value = await request(`${backend.url}/v1/admin/retention`, { Accept: 'application/json', 'Content-Type': 'application/json', ...backend.authHeaders() }, active.signal, 'PUT', { ...draft.value })
    if (current !== generation || scope !== identity()) return
    saved.value = policy(value); draft.value = { ...saved.value }
    message.value = 'Saved on this backend. Deletions still require a reviewed snapshot-set action.'
  } catch (cause) { if (current === generation) error.value = cause.name === 'AbortError' ? 'The save result is unknown. Reload the backend policy before trying again.' : cause.message }
  finally { clearTimeout(timer); if (current === generation) busy.value = false }
}
watch(identity, load, { immediate: true })
onBeforeUnmount(() => { generation++; controller?.abort() })
</script>

<template>
  <section id="snapshot-retention" class="space-y-5" data-testid="settings-snapshot-retention" aria-labelledby="retention-heading">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="retention-heading" class="text-xl font-semibold">Snapshot retention</h2><span class="badge badge-warning" data-testid="retention-inactive">Not enforced</span></div>
    <p class="text-sm text-base-content/75">Choose which completed snapshot sets appear in retention reviews. The backend does not automatically expire or delete snapshots. Review and confirm deletion in the deployment’s Snapshot sets panel.</p>
    <p v-if="!backend.url" class="text-sm">Add a backend connection to manage its retention policy.</p>
    <p v-else class="text-xs text-base-content/75 break-all">Backend: {{ backend.activeHost?.label || backend.url }}</p>
    <p v-if="busy && !draft" role="status">Loading retention policy…</p>
    <p v-if="error" id="retention-error" role="alert" class="text-sm text-error">{{ error }}</p>
    <form v-if="draft" class="space-y-4" novalidate @submit.prevent="save">
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label for="retention-count" class="block text-sm font-medium mb-1">Keep last N snapshot sets</label><input id="retention-count" ref="countInput" v-model.number="draft.keep_count" name="retention-count" type="number" min="0" max="10000" step="1" class="input w-full" :disabled="busy || role !== 'admin'" :aria-invalid="invalid === 'keep_count'" :aria-describedby="invalid === 'keep_count' ? 'retention-error' : undefined" data-testid="retention-keep-count" /></div>
        <div><label for="retention-days" class="block text-sm font-medium mb-1">Keep snapshot sets newer than (days)</label><input id="retention-days" ref="daysInput" v-model.number="draft.keep_days" name="retention-days" type="number" min="0" max="36500" step="1" class="input w-full" :disabled="busy || role !== 'admin'" :aria-invalid="invalid === 'keep_days'" :aria-describedby="invalid === 'keep_days' ? 'retention-error' : undefined" data-testid="retention-keep-days" /></div>
      </div>
      <p v-if="role !== 'admin'" class="text-sm text-base-content/75">Only a backend administrator can change this policy.</p>
      <button v-else type="submit" class="btn btn-primary btn-sm" :disabled="busy">{{ busy ? 'Saving…' : 'Save retention policy' }}</button>
    </form>
    <div class="flex flex-wrap items-center gap-3"><button v-if="backend.url" type="button" class="btn btn-outline btn-sm" :disabled="busy" data-testid="retention-reload" @click="reload">Reload backend policy</button><span v-if="dirty" class="text-xs text-base-content/75">Unsaved changes</span></div>
    <p role="status" class="text-sm text-base-content/80">{{ message }}</p>
  </section>
</template>

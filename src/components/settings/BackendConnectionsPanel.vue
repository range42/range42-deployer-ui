<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import BackendReadinessDetails from '@/components/BackendReadinessDetails.vue'
import BackendAccessPanel from '@/components/BackendAccessPanel.vue'

const emit = defineEmits(['dirty'])
const backend = useBackendApiStore()
const { confirm } = useConfirmDialog()
const emptyForm = () => ({ id: '', label: '', url: '', token: '' })
const form = ref(emptyForm()), original = ref(JSON.stringify(form.value))
const urlError = ref(''), status = ref(''), urlInput = ref(null)
const testing = ref(new Set())
const dirty = computed(() => JSON.stringify(form.value) !== original.value)
watch(dirty, value => emit('dirty', value))
function reset() { form.value = emptyForm(); original.value = JSON.stringify(form.value); urlError.value = '' }
async function edit(host) {
  if (dirty.value && !await confirm({ title: 'Discard connection edits?', message: 'Your unsaved connection changes will be lost.', confirmText: 'Discard changes' })) return
  form.value = { id: host.id, label: host.label, url: host.url, token: host.token || '' }
  original.value = JSON.stringify(form.value); urlError.value = ''; status.value = ''
  await nextTick(); urlInput.value?.focus()
}
function save() {
  urlError.value = ''; status.value = ''
  let url
  try {
    const parsed = new URL(form.value.url.trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an http:// or https:// backend URL.')
    if (parsed.username || parsed.password) throw new Error('Enter credentials in the token field, not in the URL.')
    if (parsed.search || parsed.hash) throw new Error('Enter the backend base URL without a query or fragment.')
    url = parsed.href.replace(/\/+$/, '')
  } catch (error) {
    urlError.value = error instanceof TypeError ? 'Enter a valid http:// or https:// backend URL.' : error.message
    urlInput.value?.focus(); return
  }
  const patch = { label: form.value.label.trim(), url, token: form.value.token.trim() }
  if (form.value.id) backend.updateHost(form.value.id, patch)
  else backend.addHost(patch)
  status.value = backend.storageError ? '' : 'Connection saved in this browser. Test it to verify backend access.'
  reset()
}
function retrySaving() {
  if (backend.retryPersistence()) status.value = 'Saved connection profiles are now stored in this browser.'
}
async function test(host) {
  testing.value.add(host.id)
  try { await backend.testConnection(host.id) }
  finally { testing.value.delete(host.id) }
}
async function remove(host) {
  if (!await confirm({ title: 'Remove saved connection?', message: `Remove ${host.label || host.url} from this browser? Projects using it will need another connection.`, confirmText: 'Remove connection', confirmClass: 'btn-error' })) return
  backend.removeHost(host.id)
  if (form.value.id === host.id) reset()
  status.value = 'Saved connection removed.'
}
const healthLabels = { ok: 'Ready', degraded: 'Not ready', unreachable: 'Unreachable', unauthorized: 'Authentication required', forbidden: 'Access denied' }
</script>

<template>
  <section id="backend-api" class="space-y-6" data-testid="settings-backend-api" aria-labelledby="connections-heading">
    <div>
      <h2 id="connections-heading" class="text-xl font-semibold">Backend connections</h2>
      <p class="mt-2 text-sm text-base-content/75">Choose the backend used by Catalog, Sources and Deployments. Projects keep their own saved connection.</p>
    </div>
    <div v-if="backend.hosts.length" class="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <label for="active-backend" class="block text-sm font-medium mb-2">Active backend</label>
      <select id="active-backend" :value="backend.activeHost?.id" class="select w-full" data-testid="active-backend" @change="backend.setActiveHost($event.target.value)">
        <option v-for="host in backend.hosts" :key="host.id" :value="host.id">{{ host.label || host.url }}</option>
      </select>
      <p class="text-xs text-base-content/75 mt-2 break-all">{{ backend.url }}</p>
    </div>
    <ul v-if="backend.hosts.length" class="space-y-3" aria-label="Saved backend connections">
      <li v-for="host in backend.hosts" :key="host.id" class="rounded-xl border border-base-300 p-4 min-w-0" data-testid="backend-host-row">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><h3 class="font-medium break-words">{{ host.label || host.url }}</h3><span v-if="host.id === backend.activeHost?.id" class="badge badge-primary badge-sm">Active</span></div>
            <p class="text-xs text-base-content/75 break-all mt-1">{{ host.url }}</p>
            <p class="text-xs text-base-content/75 mt-1">Default node: {{ host.nodeName }} · {{ host.token ? 'Token saved' : 'No token saved' }}</p>
          </div>
          <div class="flex flex-wrap gap-1">
            <button type="button" class="btn btn-outline btn-sm" :disabled="testing.has(host.id)" @click="test(host)">{{ testing.has(host.id) ? 'Testing…' : 'Test' }}</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="edit(host)">Edit</button>
            <button type="button" class="btn btn-ghost btn-sm text-error" @click="remove(host)">Remove</button>
          </div>
        </div>
        <div v-if="host.health" class="mt-3 space-y-3" aria-live="polite">
          <p class="text-sm"><span class="badge badge-sm" :class="host.health.status === 'ok' ? 'badge-success' : 'badge-warning'">{{ healthLabels[host.health.status] }}</span><span v-if="host.health.rtt_ms != null" class="ml-2 text-xs tabular-nums">{{ host.health.rtt_ms }} ms</span></p>
          <p v-if="host.health.status === 'unauthorized'" class="text-sm">Edit this connection and enter a valid backend API token.</p>
          <p v-else-if="host.health.status === 'forbidden'" class="text-sm">This token lacks access. Ask your backend administrator to check its permissions.</p>
          <p v-else-if="host.health.status === 'unreachable'" class="text-sm">Check the URL and network connection, then test again.</p>
          <BackendReadinessDetails :checks="host.health.checks" />
        </div>
      </li>
    </ul>
    <p v-else class="rounded-xl border border-dashed border-base-300 p-6 text-sm" data-testid="backend-host-empty">Add your backend connection to browse catalogs and manage deployments.</p>
    <form class="rounded-xl border border-base-300 p-4 space-y-4" novalidate data-testid="backend-connection-form" @submit.prevent="save">
      <h3 class="font-semibold">{{ form.id ? 'Edit connection' : 'Add a connection' }}</h3>
      <div>
        <label for="backend-label" class="block text-sm font-medium mb-1">Connection name</label>
        <input id="backend-label" v-model="form.label" name="backend-label" autocomplete="off" class="input w-full" placeholder="Training lab…" data-testid="backend-label" />
      </div>
      <div>
        <label for="backend-url" class="block text-sm font-medium mb-1">Backend URL</label>
        <input id="backend-url" ref="urlInput" v-model="form.url" name="backend-url" type="url" autocomplete="off" spellcheck="false" class="input w-full" :aria-invalid="!!urlError" :aria-describedby="urlError ? 'backend-url-error' : undefined" placeholder="https://range.example…" data-testid="backend-url" />
        <p v-if="urlError" id="backend-url-error" class="text-sm text-error mt-1" role="alert" data-testid="backend-url-error">{{ urlError }}</p>
      </div>
      <div>
        <label for="backend-token" class="block text-sm font-medium mb-1">Backend API token</label>
        <input id="backend-token" v-model="form.token" name="backend-token" type="password" autocomplete="new-password" spellcheck="false" class="input w-full" data-testid="backend-token" aria-describedby="backend-token-help" />
        <p id="backend-token-help" class="text-xs text-base-content/75 mt-1">Stored in this browser. Use the backend token, not a Proxmox or Git token. Clear this field only for a backend configured without authentication.</p>
      </div>
      <p class="text-xs text-base-content/75">Select a registered Proxmox node below after connecting. Saving this profile does not register or change a Proxmox host.</p>
      <div class="flex flex-wrap gap-2"><button type="submit" class="btn btn-primary btn-sm">{{ form.id ? 'Save changes' : 'Add connection' }}</button><button v-if="form.id || dirty" type="button" class="btn btn-ghost btn-sm" @click="reset">Cancel</button></div>
    </form>
    <p role="status" class="text-sm text-base-content/80">{{ status }}</p>
    <div v-if="backend.storageError" class="rounded-lg border border-warning/40 p-3 space-y-2">
      <p role="alert" class="text-sm" data-testid="backend-storage-error">{{ backend.storageError }}</p>
      <button type="button" class="btn btn-outline btn-sm" data-testid="retry-backend-storage" @click="retrySaving">Retry saving connections</button>
    </div>
    <BackendAccessPanel />
  </section>
</template>

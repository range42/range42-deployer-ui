<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'
import { useCatalog, type CatalogEntry } from '@/composables/useCatalog'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { prepareCatalogAppend } from '@/services/catalogProjectAppend'
import type { CanvasNode } from '@/overlay/serialize'
import { ensureNamespaces } from '@/i18n'

const props = defineProps<{ entry: CatalogEntry; initialProjectId?: string; initialNodeId?: string }>()
const emit = defineEmits<{ close: []; added: [result: { projectId: string; nodeId?: string; file?: string; tab: string; open: boolean }] }>()
const { t } = useI18n()
const projects = useProjectStore()
const inventory = useInventoryStore()
const backend = useBackendApiStore()
const catalog = useCatalog()
const projectId = ref(projects.getProject(props.initialProjectId) ? props.initialProjectId : '')
const targetNode = ref(props.initialNodeId || '')
const instanceName = ref('')
const hostPorts = ref<string[]>([])
const secretBindings = ref<Array<{ placeholder: string; variable: string }>>([])
const validationField = ref('')
const dialog = ref<HTMLElement | null>(null)
const busy = ref(false), error = ref(''), heading = ref<HTMLElement | null>(null), focusReady = ref(false)
const preview = ref<Awaited<ReturnType<typeof prepareCatalogAppend>>>()
const project = computed(() => projects.getProject(projectId.value))
const source = computed(() => inventory.getSource(props.entry.source_id))
const needsTarget = computed(() => ['ansible_role', 'container'].includes(props.entry.kind))
const readToken = ref(''), credentialError = ref(''), credentialStatus = ref(''), hasReadToken = ref(false)
const credentialRevision = ref(0)
const credentialScope = computed(() => JSON.stringify([props.entry.source_id, backend.activeHost?.id, backend.url, backend.token,
  source.value?.backend_url, source.value?.provider, source.value?.base_url, source.value?.repos]))
let knownReadToken: string | null = null
const vms = computed(() => (project.value?.nodes || []).filter(node => node.type === 'vm'))
const identity = computed(() => JSON.stringify([props.entry, source.value, project.value, projectId.value, targetNode.value,
  instanceName.value, hostPorts.value, secretBindings.value, backend.url, backend.activeHost?.id, backend.activeHost?.token, credentialRevision.value]))
let epoch = 0
let reviewed: { identity: string; token: string | null } | undefined
let closed = false, applied = false
watch(identity, () => {
  const hadReview = busy.value || !!preview.value
  epoch += 1; busy.value = false; preview.value = undefined; reviewed = undefined
  if (hadReview) error.value = t('catalog.append.changed')
}, { flush: 'sync' })
watch(credentialScope, () => {
  readToken.value = ''; credentialError.value = ''; credentialStatus.value = ''
  knownReadToken = inventory.getToken(props.entry.source_id); hasReadToken.value = !!knownReadToken
  credentialRevision.value++
}, { immediate: true, flush: 'sync' })
watch(projectId, () => { targetNode.value = '' })
onMounted(async () => {
  window.addEventListener('storage', credentialStorageChanged)
  await ensureNamespaces(['catalog']); await nextTick(); focusReady.value = !closed
})
onBeforeUnmount(() => { closed = true; epoch += 1; readToken.value = ''; window.removeEventListener('storage', credentialStorageChanged) })
function close() { closed = true; epoch += 1; readToken.value = ''; emit('close') }

function credentialStorageChanged(event: StorageEvent) {
  if (event.key !== null && !event.key.startsWith('range42_token_')) return
  const token = inventory.getToken(props.entry.source_id)
  if (token === knownReadToken) return
  knownReadToken = token; hasReadToken.value = !!token; readToken.value = ''; credentialStatus.value = ''; credentialError.value = ''
  credentialRevision.value++
}
function saveReadToken() {
  if (closed || applied) return
  credentialError.value = ''; credentialStatus.value = ''
  const token = readToken.value.trim()
  if (!token) { credentialError.value = t('catalog.append.read_access.required'); return }
  const origin = source.value
  if (!origin || origin.repos.length !== 1 || (origin.backend_url !== undefined && origin.backend_url.replace(/\/+$/, '') !== backend.url.replace(/\/+$/, ''))) {
    readToken.value = ''; credentialError.value = t('catalog.append.read_access.unavailable'); return
  }
  // The store swallows failed writes: verify persisted bytes before claiming success.
  try {
    inventory.setToken(origin.id, token)
    if (inventory.getToken(origin.id) !== token) throw new Error('Credential persistence failed')
    knownReadToken = token; hasReadToken.value = true; credentialRevision.value++
    credentialStatus.value = t('catalog.append.read_access.saved')
  } catch { credentialError.value = t('catalog.append.read_access.storage_failed') }
  finally { readToken.value = '' }
}

async function invalid(field: string, message: string) {
  validationField.value = field
  error.value = t(`catalog.append.${message}`)
  await nextTick()
  dialog.value?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()
}

async function review() {
  if (closed || busy.value || applied) return
  preview.value = undefined; reviewed = undefined; error.value = ''; validationField.value = ''
  if (!project.value) { await invalid('project', 'choose_project'); return }
  if (!source.value) { error.value = t('catalog.handoff.missing'); return }
  if (needsTarget.value && !vms.value.some(node => node.id === targetNode.value)) { await invalid('target-node', 'choose_vm'); return }
  const current = ++epoch
  const captured = { identity: identity.value, token: inventory.getToken(props.entry.source_id) }
  const snapshot = JSON.parse(JSON.stringify(project.value))
  busy.value = true
  try {
    let chosenPorts: number[] | undefined
    let chosenSecrets: Record<string, string> | undefined
    if (props.entry.kind === 'container' && secretBindings.value.length) {
      chosenSecrets = {}
      for (const [index, row] of secretBindings.value.entries()) {
        const placeholder = row.placeholder.trim(), variable = row.variable.trim()
        if (![placeholder, variable].every(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value))) {
          await invalid(`secret-${/^[A-Za-z_][A-Za-z0-9_]*$/.test(placeholder) ? 'variable' : 'placeholder'}-${index}`, 'invalid_secret_bindings')
          return
        }
        if (Object.hasOwn(chosenSecrets, placeholder)) { await invalid(`secret-placeholder-${index}`, 'duplicate_secret_binding'); return }
        Object.defineProperty(chosenSecrets, placeholder, { value: variable, enumerable: true, configurable: true })
      }
    }
    if (props.entry.kind === 'container' && hostPorts.value.length) {
      chosenPorts = []
      for (const [index, value] of hostPorts.value.entries()) {
        if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
          await invalid(`host-port-${index}`, 'invalid_ports'); return
        }
        chosenPorts.push(Number(value))
      }
    }
    const detail = await catalog.getEntry(props.entry.source_id, props.entry.path)
    if (closed || current !== epoch) return
    if (!detail) throw new Error(t('catalog.handoff.missing'))
    if (detail.source_id !== props.entry.source_id || detail.path !== props.entry.path || detail.kind !== props.entry.kind
      || (props.entry.sha && detail.sha !== props.entry.sha)) throw new Error(t('catalog.append.revision_changed'))
    const result = await prepareCatalogAppend({ entry: detail, source: source.value, project: snapshot,
      targetNode: targetNode.value || undefined, instanceName: instanceName.value || undefined, ...(chosenPorts ? { hostPorts: chosenPorts } : {}), ...(chosenSecrets ? { secretBindings: chosenSecrets } : {}) })
    if (closed || current !== epoch) return
    if (captured.identity !== identity.value || captured.token !== inventory.getToken(props.entry.source_id)) throw new Error(t('catalog.append.changed'))
    preview.value = result; reviewed = captured
  } catch (cause) {
    if (!closed && current === epoch) {
      const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined
      let message = typeof status === 'number' && status >= 400 && status <= 599
        ? t('catalog.append.read_access.provider_failed', { status }) : cause instanceof Error ? cause.message : String(cause)
      for (const token of [captured.token, backend.token].filter((value): value is string => !!value)) message = message.split(token).join('[redacted]')
      error.value = message
    }
  } finally { if (current === epoch) busy.value = false }
}

function add(open: boolean) {
  if (closed || applied || busy.value || !preview.value) return
  error.value = ''
  if (!reviewed || reviewed.identity !== identity.value || reviewed.token !== inventory.getToken(props.entry.source_id) || !project.value) {
    preview.value = undefined; error.value = t('catalog.append.changed'); return
  }
  const result = preview.value
  const id = projectId.value!
  const nodeId = result.addedNodeIds[0] || targetNode.value || undefined
  try {
    // Persist first: quota errors leave both the current project and preview intact.
    projects.updateProject(id, result.project)
    applied = true
    emit('added', { projectId: id, nodeId, file: result.selectedFile, tab: needsTarget.value ? 'config' : 'canvas', open })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
const additionalWarnings = computed(() => preview.value?.warnings.filter(item => ![...(workload.value?.prerequisites || []), ...(workload.value?.limitations || [])].includes(item)) || [])
const newNodes = computed(() => preview.value?.project.nodes.filter(node => preview.value?.addedNodeIds.includes(node.id)) || [])
function resources(node: CanvasNode) {
  const config = node.data?.config || {}
  return [['template'], ['cores'], ['memory', 'memory_mb'], ['diskSize', 'disk_gb'], ['image']]
    .map(keys => ({ label: keys[0], value: config[keys.find(key => config[key] !== undefined) || keys[0]] }))
    .filter(field => field.value !== undefined)
}
const workload = computed(() => preview.value?.review as undefined | {
  service: string; images: string[]; destination: string;
  port_mappings: Array<{ host_port: number; container_port: number; protocol: string }>;
  prerequisites: string[]; limitations: string[];
})
</script>

<template>
  <FocusTrap initial-focus="#catalog-append-title" :active="focusReady" fallback-focus="#catalog-append-title" :escape-deactivates="false">
    <div class="modal modal-open transition-none z-[1000] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="catalog-append-title" data-testid="catalog-append-dialog" @keydown.esc.stop.prevent="close">
      <section ref="dialog" class="modal-box w-full max-w-3xl max-h-[92vh] overflow-y-auto overscroll-contain space-y-5">
        <header class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wide text-base-content/60">{{ t('catalog.append.eyebrow') }}</p>
            <h2 id="catalog-append-title" ref="heading" tabindex="-1" class="text-xl font-semibold mt-1">{{ t('catalog.append.title') }}</h2>
            <p class="text-sm mt-2 break-words">{{ entry.name }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-testid="catalog-append-close" @click="close">{{ t('catalog.append.cancel') }}</button>
        </header>
        <p class="text-sm text-base-content/70">{{ t('catalog.append.scope') }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="form-control gap-1">
            <span class="text-sm font-medium">{{ t('catalog.append.project') }}</span>
            <select v-model="projectId" name="project" :aria-invalid="validationField === 'project' && !!error" :aria-describedby="validationField === 'project' ? 'catalog-append-error' : undefined" class="select select-bordered w-full">
              <option value="">{{ t('catalog.append.choose_project') }}</option>
              <option v-for="item in projects.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label v-if="needsTarget" class="form-control gap-1">
            <span class="text-sm font-medium">{{ t('catalog.append.target') }}</span>
            <select v-model="targetNode" name="target-node" :aria-invalid="validationField === 'target-node' && !!error" :aria-describedby="validationField === 'target-node' ? 'catalog-append-error' : undefined" class="select select-bordered w-full">
              <option value="">{{ t('catalog.append.choose_vm') }}</option>
              <option v-for="vm in vms" :key="vm.id" :value="vm.id">{{ vm.data?.label || vm.id }}</option>
            </select>
          </label>
          <label class="form-control gap-1" :class="{ 'sm:col-span-2': needsTarget }">
            <span class="text-sm font-medium">{{ t('catalog.append.instance') }}</span>
            <input v-model="instanceName" name="instance-name" autocomplete="off" spellcheck="false" class="input input-bordered w-full" :placeholder="t('catalog.append.instance_hint')" maxlength="48" />
          </label>
          <fieldset v-if="entry.kind === 'container'" class="sm:col-span-2 rounded-xl border border-base-300 p-4 space-y-3">
            <legend class="px-1 text-sm font-medium">{{ t('catalog.append.host_ports') }}</legend>
            <p id="catalog-host-ports-hint" class="text-xs text-base-content/70">{{ t('catalog.append.host_ports_hint') }}</p>
            <div v-for="(_, index) in hostPorts" :key="index" class="flex items-end gap-2">
              <label class="form-control flex-1 gap-1">
                <span class="text-sm">{{ t('catalog.append.port_mapping', { number: index + 1 }) }}</span>
                <input v-model="hostPorts[index]" :name="`host-port-${index}`" type="text" inputmode="numeric" autocomplete="off" class="input input-bordered w-full" :aria-invalid="validationField === `host-port-${index}` && !!error" :aria-describedby="validationField === `host-port-${index}` ? 'catalog-append-error' : 'catalog-host-ports-hint'" :placeholder="t('catalog.append.host_ports_example')" />
              </label>
              <button type="button" class="btn btn-ghost" :data-testid="`catalog-remove-port-${index}`" :aria-label="t('catalog.append.remove_port', { number: index + 1 })" @click="hostPorts.splice(index, 1)">{{ t('catalog.remove') }}</button>
            </div>
            <button type="button" class="btn btn-outline btn-sm" data-testid="catalog-add-port" @click="hostPorts.push('')">{{ t('catalog.append.add_port') }}</button>
          </fieldset>
          <fieldset v-if="entry.kind === 'container'" class="sm:col-span-2 rounded-xl border border-base-300 p-4 space-y-3">
            <legend class="px-1 text-sm font-medium">{{ t('catalog.append.secret_bindings') }}</legend>
            <p id="catalog-secret-bindings-hint" class="text-xs text-base-content/70">{{ t('catalog.append.secret_bindings_hint') }}</p>
            <div v-for="(row, index) in secretBindings" :key="index" class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
              <label v-for="field in (['placeholder', 'variable'] as const)" :key="field" class="form-control gap-1">
                <span class="text-sm">{{ t(`catalog.append.secret_${field}`) }}</span>
                <input v-model="row[field]" :name="`secret-${field}-${index}`" autocomplete="off" spellcheck="false" class="input input-bordered font-mono text-sm w-full" :aria-invalid="validationField === `secret-${field}-${index}` && !!error" :aria-describedby="validationField === `secret-${field}-${index}` ? 'catalog-append-error' : 'catalog-secret-bindings-hint'" :placeholder="field === 'placeholder' ? 'DB_PASSWORD…' : 'workload_password…'" />
              </label>
              <button type="button" class="btn btn-ghost justify-self-end" :data-testid="`catalog-remove-secret-${index}`" :aria-label="t('catalog.append.remove_secret', { number: index + 1 })" @click="secretBindings.splice(index, 1)">{{ t('catalog.remove') }}</button>
            </div>
            <button type="button" class="btn btn-outline btn-sm" data-testid="catalog-add-secret-binding" @click="secretBindings.push({ placeholder: '', variable: '' })">{{ t('catalog.append.add_secret') }}</button>
          </fieldset>
        </div>
        <p v-if="!projects.projects.length" class="text-sm" role="status">{{ t('catalog.append.no_projects') }}</p>
        <p v-if="entry.kind === 'ansible_role'" class="rounded-lg bg-base-200 p-3 text-sm">{{ t('catalog.append.role_hint') }}</p>
        <p v-if="entry.kind === 'container'" class="rounded-lg bg-base-200 p-3 text-sm">{{ t('catalog.append.container_hint') }}</p>
        <details v-if="needsTarget && source" class="rounded-xl border border-base-300 p-4" data-testid="catalog-read-access">
          <summary class="cursor-pointer text-sm font-medium">{{ t('catalog.append.read_access.title') }}</summary>
          <div class="mt-3 space-y-3">
            <p class="text-sm text-base-content/75">{{ t('catalog.append.read_access.help') }}</p>
            <p class="text-xs break-all">{{ t('catalog.append.read_access.source') }}: {{ source.provider }} · {{ source.base_url }} · {{ source.repos.map(repo => `${repo.owner}/${repo.repo}`).join(', ') }}</p>
            <p class="text-xs break-all">{{ t('catalog.append.read_access.backend') }}: {{ backend.activeHost?.label || backend.url || t('catalog.append.read_access.same_origin') }}</p>
            <p class="text-xs text-base-content/75">{{ t(hasReadToken ? 'catalog.append.read_access.exists' : 'catalog.append.read_access.missing') }}</p>
            <form class="space-y-3" @submit.prevent="saveReadToken">
              <label for="catalog-read-token" class="block text-sm font-medium">{{ t('catalog.append.read_access.label') }}</label>
              <input id="catalog-read-token" v-model="readToken" name="catalog-read-token" type="password" autocomplete="new-password" spellcheck="false" class="input input-bordered w-full" :aria-invalid="!!credentialError" :aria-describedby="credentialError ? 'catalog-read-credential-error' : undefined" data-testid="catalog-read-token" />
              <button type="submit" class="btn btn-outline btn-sm" data-testid="catalog-save-read-token">{{ t('catalog.append.read_access.save') }}</button>
            </form>
            <p v-if="credentialError" id="catalog-read-credential-error" role="alert" class="rounded-lg border border-error/40 bg-error/10 p-3 text-base-content text-sm" data-testid="catalog-read-credential-error">{{ credentialError }}</p>
            <p v-if="credentialStatus" role="status" class="text-sm" data-testid="catalog-read-credential-status">{{ credentialStatus }}</p>
          </div>
        </details>
        <div v-if="preview" class="rounded-xl border border-base-300 p-4 space-y-3" data-testid="catalog-append-preview">
          <h3 class="font-semibold">{{ t('catalog.append.preview') }}</h3>
          <p class="text-sm">{{ t('catalog.append.counts', preview.counts) }}</p>
          <ul v-if="newNodes.length" class="grid gap-2 sm:grid-cols-2">
            <li v-for="node in newNodes" :key="node.id" class="rounded-lg bg-base-200 p-3 min-w-0 text-sm">
              <p class="font-medium break-words">{{ node.data?.label || node.id }} <span class="badge badge-sm badge-ghost">{{ node.type }}</span></p>
              <p class="font-mono text-xs break-all mt-1">{{ node.id }}</p>
              <dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
                <template v-for="field in resources(node)" :key="field.label">
                  <dt class="text-base-content/60">{{ t(`catalog.append.fields.${field.label}`) }}</dt><dd class="break-all">{{ field.value }}</dd>
                </template>
              </dl>
            </li>
          </ul>
          <div v-if="workload" class="space-y-3 text-sm" data-testid="catalog-workload-preview">
            <dl class="grid gap-1 sm:grid-cols-[8rem_1fr]">
              <dt class="text-base-content/60">{{ t('catalog.append.service') }}</dt><dd class="break-all">{{ workload.service }}</dd>
              <dt class="text-base-content/60">{{ t('catalog.append.fields.image') }}</dt><dd class="break-all">{{ workload.images.join(', ') }}</dd>
              <dt class="text-base-content/60">{{ t('catalog.append.effective_ports') }}</dt><dd><ul><li v-for="port in workload.port_mappings" :key="`${port.host_port}/${port.protocol}`">{{ port.host_port }} → {{ port.container_port }}/{{ port.protocol }}</li></ul></dd>
              <dt class="text-base-content/60">{{ t('catalog.append.directory') }}</dt><dd class="font-mono text-xs break-all">{{ workload.destination }}</dd>
            </dl>
            <ul class="space-y-2"><li v-for="item in [...workload.prerequisites, ...workload.limitations]" :key="item">{{ item }}</li></ul>
          </div>
          <ul v-if="additionalWarnings.length" class="text-sm space-y-2"><li v-for="warning in additionalWarnings" :key="warning">{{ warning }}</li></ul>
          <p class="text-xs text-base-content/60 break-all">{{ t('catalog.handoff.origin') }}: {{ entry.source_id }} · {{ entry.path }} · {{ entry.sha }}</p>
          <p class="text-sm">{{ t('catalog.append.save_hint') }}</p>
        </div>
        <p v-if="error" id="catalog-append-error" role="alert" class="rounded-lg border border-error/40 bg-error/10 p-3 text-base-content text-sm break-words">{{ error }}</p>
        <p v-if="busy" role="status" class="text-sm">{{ t('catalog.append.loading') }}</p>
        <footer class="flex flex-wrap justify-end gap-2">
          <button v-if="!preview" type="button" class="btn btn-primary" data-testid="catalog-append-review" :disabled="busy" @click="review">{{ t('catalog.append.review') }}</button>
          <template v-else>
            <button type="button" class="btn btn-outline" data-testid="catalog-append-keep" @click="add(false)">{{ t('catalog.append.keep_browsing') }}</button>
            <button type="button" class="btn btn-primary" data-testid="catalog-append-open" @click="add(true)">{{ t('catalog.append.open_project') }}</button>
          </template>
        </footer>
      </section>
    </div>
  </FocusTrap>
</template>

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
const hostPorts = ref('')
const secretBindings = ref('')
const busy = ref(false), error = ref(''), heading = ref<HTMLElement | null>(null), focusReady = ref(false)
const preview = ref<Awaited<ReturnType<typeof prepareCatalogAppend>>>()
const project = computed(() => projects.getProject(projectId.value))
const source = computed(() => inventory.getSource(props.entry.source_id))
const needsTarget = computed(() => ['ansible_role', 'container'].includes(props.entry.kind))
const vms = computed(() => (project.value?.nodes || []).filter(node => node.type === 'vm'))
const identity = computed(() => JSON.stringify([props.entry, source.value, project.value, projectId.value, targetNode.value,
  instanceName.value, hostPorts.value, secretBindings.value, backend.url, backend.activeHost?.id, backend.activeHost?.token]))
let epoch = 0
let reviewed: { identity: string; token: string | null } | undefined
let closed = false, applied = false
watch(identity, () => {
  const hadReview = busy.value || !!preview.value
  epoch += 1; busy.value = false; preview.value = undefined; reviewed = undefined
  if (hadReview) error.value = t('catalog.append.changed')
}, { flush: 'sync' })
watch(projectId, () => { targetNode.value = '' })
onMounted(async () => { await ensureNamespaces(['catalog']); await nextTick(); focusReady.value = !closed })
onBeforeUnmount(() => { closed = true; epoch += 1 })
function close() { closed = true; epoch += 1; emit('close') }

async function review() {
  if (closed || busy.value || applied) return
  preview.value = undefined; reviewed = undefined; error.value = ''
  if (!project.value) { error.value = t('catalog.append.choose_project'); return }
  if (!source.value) { error.value = t('catalog.handoff.missing'); return }
  if (needsTarget.value && !vms.value.some(node => node.id === targetNode.value)) { error.value = t('catalog.append.choose_vm'); return }
  const current = ++epoch
  const captured = { identity: identity.value, token: inventory.getToken(props.entry.source_id) }
  const snapshot = JSON.parse(JSON.stringify(project.value))
  busy.value = true
  try {
    let chosenPorts: number[] | undefined
    let chosenSecrets: Record<string, string> | undefined
    if (props.entry.kind === 'container' && secretBindings.value.trim()) {
      try {
        const value = JSON.parse(secretBindings.value)
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(name => typeof name !== 'string')) throw new Error()
        chosenSecrets = value
      } catch { throw new Error(t('catalog.append.invalid_secret_bindings')) }
    }
    if (props.entry.kind === 'container' && hostPorts.value.trim()) {
      chosenPorts = hostPorts.value.split(',').map(value => {
        if (!/^\d+$/.test(value.trim()) || Number(value) < 1 || Number(value) > 65535) throw new Error(t('catalog.append.invalid_ports'))
        return Number(value)
      })
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
    if (!closed && current === epoch) error.value = cause instanceof Error ? cause.message : String(cause)
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
  <FocusTrap :active="focusReady" :fallback-focus="() => heading" :escape-deactivates="false">
    <div class="modal modal-open z-[1000] p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="catalog-append-title" data-testid="catalog-append-dialog" @keydown.esc.stop.prevent="close">
      <section class="modal-box w-full max-w-3xl max-h-[92vh] overflow-y-auto overscroll-contain space-y-5">
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
            <select v-model="projectId" name="project" class="select select-bordered w-full">
              <option value="">{{ t('catalog.append.choose_project') }}</option>
              <option v-for="item in projects.projects" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label v-if="needsTarget" class="form-control gap-1">
            <span class="text-sm font-medium">{{ t('catalog.append.target') }}</span>
            <select v-model="targetNode" name="target-node" class="select select-bordered w-full">
              <option value="">{{ t('catalog.append.choose_vm') }}</option>
              <option v-for="vm in vms" :key="vm.id" :value="vm.id">{{ vm.data?.label || vm.id }}</option>
            </select>
          </label>
          <label class="form-control gap-1" :class="{ 'sm:col-span-2': needsTarget }">
            <span class="text-sm font-medium">{{ t('catalog.append.instance') }}</span>
            <input v-model="instanceName" name="instance-name" autocomplete="off" spellcheck="false" class="input input-bordered w-full" :placeholder="t('catalog.append.instance_hint')" maxlength="48" />
          </label>
          <label v-if="entry.kind === 'container'" class="form-control gap-1 sm:col-span-2">
            <span class="text-sm font-medium">{{ t('catalog.append.host_ports') }}</span>
            <input v-model="hostPorts" name="host-ports" autocomplete="off" spellcheck="false" class="input input-bordered w-full" :placeholder="t('catalog.append.host_ports_example')" aria-describedby="catalog-host-ports-hint" />
            <span id="catalog-host-ports-hint" class="text-xs text-base-content/60">{{ t('catalog.append.host_ports_hint') }}</span>
          </label>
          <label v-if="entry.kind === 'container'" class="form-control gap-1 sm:col-span-2">
            <span class="text-sm font-medium">{{ t('catalog.append.secret_bindings') }}</span>
            <textarea v-model="secretBindings" name="secret-bindings" autocomplete="off" spellcheck="false" class="textarea textarea-bordered font-mono w-full" rows="2" placeholder='{"DB_PASSWORD":"workload_password"}' aria-describedby="catalog-secret-bindings-hint" />
            <span id="catalog-secret-bindings-hint" class="text-xs text-base-content/60">{{ t('catalog.append.secret_bindings_hint') }}</span>
          </label>
        </div>
        <p v-if="!projects.projects.length" class="text-sm" role="status">{{ t('catalog.append.no_projects') }}</p>
        <p v-if="entry.kind === 'ansible_role'" class="rounded-lg bg-base-200 p-3 text-sm">{{ t('catalog.append.role_hint') }}</p>
        <p v-if="entry.kind === 'container'" class="rounded-lg bg-base-200 p-3 text-sm">{{ t('catalog.append.container_hint') }}</p>
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
          <ul v-if="preview.warnings.length" class="text-sm space-y-2"><li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li></ul>
          <p class="text-xs text-base-content/60 break-all">{{ t('catalog.handoff.origin') }}: {{ entry.source_id }} · {{ entry.path }} · {{ entry.sha }}</p>
          <p class="text-sm">{{ t('catalog.append.save_hint') }}</p>
        </div>
        <p v-if="error" role="alert" class="text-error text-sm break-words">{{ error }}</p>
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

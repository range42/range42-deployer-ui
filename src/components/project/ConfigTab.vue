<script setup>
/**
 * ConfigTab — three-pane layout:
 *   - Left:   FileTree (merge of baseFs + overlayFs)
 *   - Center: TwoPaneEditor (two vue-codemirror6 instances, NOT MergeView)
 *   - Right:  AttachmentManager (reused from C3.5)
 *
 * ConfigTab wires a small in-memory VirtualFs for the project overlay — the
 * real wire-up to ProjectRepoAdapter happens via the `overlayFs` / `baseFs`
 * props. The tab therefore works with any provider (catalog preview, local
 * draft, git-backed project) as long as both sides implement the same
 * shape:
 *   VirtualFs = {
 *     listTree(): Promise<TreeEntry[]>
 *     getFile(path): Promise<{ content: string, sha: string }>
 *     putFile(opts: { path, content, message? }): Promise<{ sha: string }>
 *   }
 *
 * Drift banner (C3.8): when the header SHA in the currently-selected
 * overlay file doesn't match the base SHA for the same path, a yellow
 * banner flags the drift and the file tree decorates the row with an
 * amber dot (`driftMap[path] === 'drift'`).
 */
import FileAssetField from './FileAssetField.vue'
import { fileContentEquals, isBinaryFile } from '@/services/projectFiles'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FileTree from './FileTree.vue'
import TwoPaneEditor from './TwoPaneEditor.vue'
import AttachmentManager from './AttachmentManager.vue'
import { readForkHeaderSha } from './fileTree'
import { parseYamlDoc, hasAnchorsOrAliases } from '@/services/yaml'

const props = defineProps({
  path: { type: String, default: '' },
  overlayFs: { type: Object, required: true },
  baseFs: { type: Object, required: true },
  attachments: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
  showAttachments: { type: Boolean, default: true },
})
const emit = defineEmits(['update:attachments', 'save', 'open-content', 'select'])
const { t } = useI18n({ useScope: 'global' })

const selectedPath = ref('')
const selectedFsKind = ref('overlay')
const baseContent = ref('')
const overlayContent = ref('')
const baseSha = ref('')
const overlaySha = ref('')
const baseExists = ref(false)
const overlayExists = ref(false)

const loadError = ref(null)
const binaryContent = computed(() => {
  const value = selectedFsKind.value === 'base' ? baseContent.value : overlayExists.value ? overlayContent.value : baseContent.value
  return isBinaryFile(value) ? value : null
})
const loading = ref(false)
const conflict = ref(false)
let loadedOverlayContent = ''
let selectionRead = 0
onBeforeUnmount(() => { selectionRead += 1 })

async function readFile(fs, path) {
  try { return await (fs.getFileContent ? fs.getFileContent(path) : fs.getFile(path)) }
  catch (error) {
    if (/not found|404/i.test(error.message || String(error))) return null
    throw error
  }
}

async function loadSelected({ preserveDraft = false } = {}) {
  const request = ++selectionRead
  const path = selectedPath.value
  if (!path) return
  const dirty = preserveDraft && !fileContentEquals(overlayContent.value, loadedOverlayContent)
  loading.value = true
  loadError.value = null
  try {
    const [b, o] = await Promise.all([readFile(props.baseFs, path), readFile(props.overlayFs, path)])
    if (request !== selectionRead) return
    if (!b && !o) throw new Error(t('project.config.missing', { path }))
    baseContent.value = b?.content ?? ''
    baseSha.value = b?.sha ?? ''
    baseExists.value = !!b
    const nextContent = o?.content ?? ''
    if (dirty && !fileContentEquals(overlayContent.value, nextContent)) {
      conflict.value = !fileContentEquals(loadedOverlayContent, nextContent)
    } else {
      overlayContent.value = nextContent
      conflict.value = false
    }
    loadedOverlayContent = nextContent
    overlaySha.value = o?.sha ?? ''
    overlayExists.value = !!o
  } catch (error) {
    if (request === selectionRead) loadError.value = error
  } finally {
    if (request === selectionRead) loading.value = false
  }
}

async function refreshSelection() {
  if (props.path || selectedPath.value) {
    const next = props.path || selectedPath.value
    const samePath = next === selectedPath.value
    selectedPath.value = next
    return loadSelected({ preserveDraft: samePath })
  }
  const request = ++selectionRead
  loading.value = true
  loadError.value = null
  try {
    const [base, overlay] = await Promise.all([props.baseFs.listTree(), props.overlayFs.listTree()])
    if (request !== selectionRead) return
    const available = [...overlay, ...base].filter(entry => entry.type === 'blob').sort((a, b) => a.path.localeCompare(b.path))
    const first = available.find(entry => /(^|\/)tasks\/main\.ya?ml$/.test(entry.path)) || available[0]
    if (!first) return
    selectedPath.value = first.path
    selectedFsKind.value = overlay.some(entry => entry.path === first.path) ? 'overlay' : 'base'
    await loadSelected()
  } catch (error) {
    if (request === selectionRead) loadError.value = error
  } finally {
    if (request === selectionRead) loading.value = false
  }
}
watch(() => [props.path, props.overlayFs, props.baseFs], refreshSelection, { immediate: true })

function onSelect({ path, fsKind }) {
  const samePath = path === selectedPath.value
  selectedPath.value = path
  selectedFsKind.value = fsKind
  void loadSelected({ preserveDraft: samePath })
  emit('select', path)
}

function onFork({ path }) {
  onSelect({ path, fsKind: 'overlay' })
}

async function onSave(payload) {
  if (loading.value || loadError.value || conflict.value || payload.path !== selectedPath.value) return
  const request = selectionRead
  try {
    const res = await props.overlayFs.putFile({
      path: payload.path,
      content: payload.content,
      message: `edit ${payload.path}`,
    })
    if (selectedPath.value === payload.path && request === selectionRead) {
      overlaySha.value = res?.sha ?? overlaySha.value
      overlayContent.value = payload.content
      loadedOverlayContent = payload.content
      overlayExists.value = true
    }
    if (request === selectionRead && selectedPath.value === payload.path) emit('save', { ...payload, sha: res?.sha ?? '' })
  } catch (error) {
    if (request === selectionRead) loadError.value = error
  }
}

// --- drift detection ---------------------------------------------------
const driftMap = computed(() => {
  const map = {}
  if (!selectedPath.value) return map
  if (!overlayExists.value || !baseExists.value || typeof overlayContent.value !== 'string') return map
  const storedSha = readForkHeaderSha(overlayContent.value)
  if (storedSha && baseSha.value && storedSha !== baseSha.value) {
    map[selectedPath.value] = 'drift'
  }
  return map
})

const driftInfo = computed(() => {
  const status = driftMap.value[selectedPath.value]
  if (status !== 'drift') return null
  return { upstreamSha: baseSha.value }
})

// YAML anchor warning (C3.8). `hasAnchorsOrAliases` is synchronous, so the
// warning renders on the same tick as the parse.
const yamlWarning = computed(() => {
  const p = (selectedPath.value || '').toLowerCase()
  if (!(p.endsWith('.yaml') || p.endsWith('.yml'))) return null
  if (!overlayContent.value || typeof overlayContent.value !== 'string') return null
  try {
    const doc = parseYamlDoc(overlayContent.value)
    return hasAnchorsOrAliases(doc) ? { anchors: true } : null
  } catch {
    return null
  }
})
</script>

<template>
  <div class="config-tab flex flex-col lg:grid gap-2 h-full min-h-0 overflow-y-auto lg:overflow-hidden"
    :class="showAttachments ? 'lg:grid-cols-[minmax(180px,240px)_1fr_minmax(240px,320px)]' : 'lg:grid-cols-[minmax(180px,240px)_1fr]'">
    <div class="border-b lg:border-b-0 lg:border-r border-base-300 h-40 lg:h-full min-h-0 shrink-0 overflow-hidden">
      <FileTree
        :overlay-fs="overlayFs"
        :base-fs="baseFs"
        :selected-path="selectedPath"
        :drift-map="driftMap"
        @select="onSelect"
        @fork="onFork"
      />
    </div>

    <div class="flex flex-col min-w-0 min-h-72 lg:min-h-0 shrink-0 lg:shrink">
      <div
        v-if="driftInfo"
        class="alert alert-warning py-1 px-2 text-xs rounded-none"
        role="alert"
        data-testid="drift-banner"
      >
        {{ $t ? $t('configTab.driftBanner', { sha: driftInfo.upstreamSha }) : `Upstream changed at ${driftInfo.upstreamSha}` }}
      </div>
      <div
        v-if="yamlWarning"
        class="alert py-1 px-2 text-xs rounded-none bg-base-200 border-b border-base-300"
        role="note"
        data-testid="yaml-anchor-warning"
      >
        {{ $t ? $t('configTab.yamlAnchorsWarning') : 'This YAML uses anchors/aliases; round-trip may rewrite them.' }}
      </div>
      <div v-if="conflict" class="alert alert-warning text-sm rounded-none" role="alert" data-testid="config-file-conflict">
        <span>{{ t('project.config.changed') }}</span>
        <button type="button" class="btn btn-sm" data-testid="config-reload-file" @click="loadSelected()">{{ t('project.config.reload') }}</button>
        <button type="button" class="btn btn-sm" data-testid="config-keep-draft" @click="conflict = false">{{ t('project.config.keepDraft') }}</button>
      </div>
      <div v-if="loading" role="status" class="p-4 text-sm" data-testid="config-file-loading">{{ t('project.config.loading') }}</div>
      <div v-else-if="!selectedPath && !loadError" class="p-4 text-sm text-base-content/70" data-testid="config-no-files">{{ t('project.config.empty') }}</div>
      <div v-else-if="!loadError" class="flex-1 min-h-0">
        <FileAssetField v-if="binaryContent" :key="selectedPath" :model-value="binaryContent" :filename="selectedPath.split('/').at(-1)" :readonly="selectedFsKind === 'base'" class="p-4" @update:model-value="content => onSave({ path: selectedPath, content })" />
        <TwoPaneEditor
          v-else
          :path="selectedPath"
          :base-content="typeof baseContent === 'string' ? baseContent : ''"
          :overlay-content="typeof overlayContent === 'string' ? overlayContent : ''"
          :base-exists="baseExists"
          :overlay-exists="overlayExists"
          @update:overlay-content="(v) => (overlayContent = v)"
          @save="onSave"
        />
      </div>
      <div v-if="loadError" role="alert" data-testid="config-file-error" class="alert alert-error text-xs py-1 px-2 rounded-none">
        {{ String(loadError.message || loadError) }}
      </div>
    </div>

    <div v-if="showAttachments" class="border-t lg:border-t-0 lg:border-l border-base-300 h-60 lg:h-full min-h-0 min-w-0 shrink-0 overflow-auto">
      <AttachmentManager
        :attachments="attachments"
        :nodes="nodes"
        @update:attachments="(next) => emit('update:attachments', next)"
        @open-content="emit('open-content', $event)"
      />
    </div>
  </div>
</template>

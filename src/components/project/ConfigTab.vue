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
import { computed, ref, watch } from 'vue'
import FileTree from './FileTree.vue'
import TwoPaneEditor from './TwoPaneEditor.vue'
import AttachmentManager from './AttachmentManager.vue'
import { readForkHeaderSha } from './fileTree'

const props = defineProps({
  overlayFs: { type: Object, required: true },
  baseFs: { type: Object, required: true },
  attachments: { type: Array, default: () => [] },
  nodes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:attachments', 'save'])

const selectedPath = ref('')
const selectedFsKind = ref('overlay')
const baseContent = ref('')
const overlayContent = ref('')
const baseSha = ref('')
const overlaySha = ref('')
const baseExists = ref(false)
const overlayExists = ref(false)

const loadError = ref(null)

async function loadSelected() {
  if (!selectedPath.value) {
    baseContent.value = ''
    overlayContent.value = ''
    baseSha.value = ''
    overlaySha.value = ''
    baseExists.value = false
    overlayExists.value = false
    return
  }
  loadError.value = null
  try {
    const b = await props.baseFs.getFile(selectedPath.value).catch(() => null)
    if (b) {
      baseContent.value = b.content ?? ''
      baseSha.value = b.sha ?? ''
      baseExists.value = true
    } else {
      baseContent.value = ''
      baseSha.value = ''
      baseExists.value = false
    }
    const o = await props.overlayFs.getFile(selectedPath.value).catch(() => null)
    if (o) {
      overlayContent.value = o.content ?? ''
      overlaySha.value = o.sha ?? ''
      overlayExists.value = true
    } else {
      overlayContent.value = ''
      overlaySha.value = ''
      overlayExists.value = false
    }
  } catch (e) {
    loadError.value = e
  }
}

watch(selectedPath, () => loadSelected(), { immediate: false })

function onSelect({ path, fsKind }) {
  selectedPath.value = path
  selectedFsKind.value = fsKind
}

function onFork({ path }) {
  // After forking, the overlay now has the file — select it on the overlay side.
  selectedPath.value = path
  selectedFsKind.value = 'overlay'
}

async function onSave(payload) {
  try {
    const res = await props.overlayFs.putFile({
      path: payload.path,
      content: payload.content,
      message: `edit ${payload.path}`,
    })
    overlaySha.value = res?.sha ?? overlaySha.value
    overlayContent.value = payload.content
    emit('save', { ...payload, sha: overlaySha.value })
  } catch (e) {
    loadError.value = e
  }
}

// --- drift detection ---------------------------------------------------
const driftMap = computed(() => {
  const map = {}
  if (!selectedPath.value) return map
  if (!overlayExists.value || !baseExists.value) return map
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

// YAML anchor warning lands in C3.8 (see `@/services/yaml`).
const yamlWarning = ref(null)
</script>

<template>
  <div class="config-tab grid grid-cols-[minmax(180px,240px)_1fr_minmax(240px,320px)] gap-2 h-full min-h-0">
    <div class="border-r border-base-300 h-full min-h-0 overflow-hidden">
      <FileTree
        :overlay-fs="overlayFs"
        :base-fs="baseFs"
        :selected-path="selectedPath"
        :drift-map="driftMap"
        @select="onSelect"
        @fork="onFork"
      />
    </div>

    <div class="flex flex-col min-w-0 min-h-0">
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
      <div class="flex-1 min-h-0">
        <TwoPaneEditor
          :path="selectedPath"
          :base-content="baseContent"
          :overlay-content="overlayContent"
          :base-exists="baseExists"
          :overlay-exists="overlayExists"
          @update:overlay-content="(v) => (overlayContent = v)"
          @save="onSave"
        />
      </div>
      <div v-if="loadError" class="alert alert-error text-xs py-1 px-2 rounded-none">
        {{ String(loadError.message || loadError) }}
      </div>
    </div>

    <div class="border-l border-base-300 h-full min-h-0 overflow-y-auto">
      <AttachmentManager
        :attachments="attachments"
        :nodes="nodes"
        @update:attachments="(next) => emit('update:attachments', next)"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * TwoPaneEditor — two vue-codemirror6 instances side by side (NOT MergeView).
 * Left pane: base filesystem, read-only.
 * Right pane: overlay filesystem, editable.
 *
 * Language is picked from the file extension: .yaml/.yml → yaml, .md →
 * markdown, Dockerfile → legacy Dockerfile, .sh → legacy shell. Plain text
 * otherwise.
 *
 * Scroll-sync: the two editors share a scrollY ref via EditorView
 * updateListener; when one scrolls, we translate the offset onto the other.
 * Save triggers: blur + Ctrl-S → emits `save({ path, content })`.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import CodeMirror from 'vue-codemirror6'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { markdown as mdLang } from '@codemirror/lang-markdown'
import { StreamLanguage } from '@codemirror/language'
import { shell as shellMode } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile as dockerfileMode } from '@codemirror/legacy-modes/mode/dockerfile'
import { EditorView } from '@codemirror/view'

const props = defineProps({
  path: { type: String, default: '' },
  baseContent: { type: String, default: '' },
  overlayContent: { type: String, default: '' },
  baseExists: { type: Boolean, default: false },
  overlayExists: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'update:overlayContent'])

const overlayBuffer = ref(props.overlayContent || '')
watch(
  () => props.overlayContent,
  (v) => {
    if (v !== overlayBuffer.value) overlayBuffer.value = v
  },
)
watch(overlayBuffer, (v) => emit('update:overlayContent', v))

const lang = computed(() => {
  const p = (props.path || '').toLowerCase()
  if (p.endsWith('.yaml') || p.endsWith('.yml')) return yamlLang()
  if (p.endsWith('.md') || p.endsWith('.markdown')) return mdLang()
  if (p.endsWith('.sh') || p.endsWith('.bash')) return StreamLanguage.define(shellMode)
  if (/(^|\/)dockerfile$/i.test(p) || p.endsWith('.dockerfile')) {
    return StreamLanguage.define(dockerfileMode)
  }
  return null
})

// --- scroll-sync -------------------------------------------------------
const leftView = shallowRef(null)
const rightView = shallowRef(null)
let syncing = false

function mirrorScroll(fromView, toView) {
  if (!fromView || !toView || syncing) return
  syncing = true
  try {
    const src = fromView.scrollDOM
    const dst = toView.scrollDOM
    if (!src || !dst) return
    dst.scrollTop = src.scrollTop
  } finally {
    // release on next microtask so nested scroll events don't deadlock
    queueMicrotask(() => {
      syncing = false
    })
  }
}

const scrollSyncLeft = EditorView.updateListener.of(() => {
  mirrorScroll(leftView.value, rightView.value)
})
const scrollSyncRight = EditorView.updateListener.of(() => {
  mirrorScroll(rightView.value, leftView.value)
})

const leftExtensions = computed(() => {
  const exts = [scrollSyncLeft]
  if (lang.value) exts.unshift(lang.value)
  return exts
})
const rightExtensions = computed(() => {
  const exts = [scrollSyncRight]
  if (lang.value) exts.unshift(lang.value)
  return exts
})

// --- save triggers -----------------------------------------------------
function doSave() {
  if (!props.path) return
  emit('save', { path: props.path, content: overlayBuffer.value })
}

function onRightBlur() {
  doSave()
}

function onRightKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    doSave()
  }
}
</script>

<template>
  <div class="two-pane-editor grid grid-cols-2 gap-2 h-full min-h-0">
    <div class="flex flex-col min-w-0 min-h-0 border border-base-200 rounded">
      <div class="px-2 py-1 text-xs font-semibold bg-base-200 flex items-center justify-between">
        <span>{{ $t ? $t('configTab.base') : 'Base (read-only)' }}</span>
        <span class="text-base-content/50 font-mono text-[10px]">{{ path }}</span>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden" data-testid="two-pane-left">
        <CodeMirror
          v-if="baseExists"
          ref="leftRef"
          :model-value="baseContent"
          :extensions="leftExtensions"
          :readonly="true"
          :disabled="true"
          :basic="true"
          style="height: 100%"
          @ready="(payload) => (leftView = payload?.view || payload)"
        />
        <div v-else class="p-2 text-xs text-base-content/60 italic">
          {{ $t ? $t('configTab.baseMissing') : 'No base file at this path' }}
        </div>
      </div>
    </div>

    <div class="flex flex-col min-w-0 min-h-0 border border-base-200 rounded">
      <div class="px-2 py-1 text-xs font-semibold bg-base-200 flex items-center justify-between">
        <span>{{ $t ? $t('configTab.overlay') : 'Overlay' }}</span>
        <span class="text-base-content/50 font-mono text-[10px]">{{ path }}</span>
      </div>
      <div
        class="flex-1 min-h-0 overflow-hidden"
        data-testid="two-pane-right"
        @keydown="onRightKeydown"
      >
        <CodeMirror
          ref="rightRef"
          v-model="overlayBuffer"
          :extensions="rightExtensions"
          :basic="true"
          :placeholder="$t ? $t('configTab.emptyOverlay') : 'Overlay empty — fork a base file or create new'"
          style="height: 100%"
          @ready="(payload) => (rightView = payload?.view || payload)"
          @blur="onRightBlur"
        />
      </div>
    </div>
  </div>
</template>

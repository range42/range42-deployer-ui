<script setup>
/**
 * FileTree — merges `baseFs.listTree()` and `overlayFs.listTree()` into a
 * single browsable list with indicators:
 *   - overlay-only   (indicator: circled solid)
 *   - base read-only (indicator: filled dot)
 *   - overlay override (indicator: circled ring with dot)
 *
 * Emits `select(path, fsKind)` when the user clicks an entry.
 * A right-click context menu offers *Fork to override* for base-only blobs.
 */
import { computed, ref, watch } from 'vue'
import { mergeTrees, buildForkHeader } from './fileTree'

const props = defineProps({
  overlayFs: {
    type: Object,
    required: true,
    // Expected shape: { listTree(): Promise<TreeEntry[]>, getFile(path): Promise<{content,sha}>, putFile(opts) }
  },
  baseFs: {
    type: Object,
    required: true,
  },
  /**
   * Optional map { path: 'drift' | 'clean' } fed by ConfigTab when the
   * drift banner is active. Paths flagged as drifted render an amber dot.
   */
  driftMap: { type: Object, default: () => ({}) },
  selectedPath: { type: String, default: '' },
})
const emit = defineEmits(['select', 'fork'])

const baseEntries = ref([])
const overlayEntries = ref([])
const loading = ref(false)
const loadError = ref(null)

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    const [b, o] = await Promise.all([
      Promise.resolve().then(() => props.baseFs.listTree()),
      Promise.resolve().then(() => props.overlayFs.listTree()),
    ])
    baseEntries.value = Array.isArray(b) ? b : []
    overlayEntries.value = Array.isArray(o) ? o : []
  } catch (e) {
    loadError.value = e
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.overlayFs, props.baseFs],
  () => refresh(),
  { immediate: true },
)

const merged = computed(() =>
  mergeTrees(baseEntries.value || [], overlayEntries.value || []).filter(
    (e) => e.type === 'blob',
  ),
)

// --- context menu (Fork to override) ---
const menu = ref({ open: false, x: 0, y: 0, entry: null })
function closeMenu() {
  menu.value = { open: false, x: 0, y: 0, entry: null }
}
function openMenu(event, entry) {
  if (entry.marker !== 'base') return
  event.preventDefault()
  menu.value = { open: true, x: event.clientX, y: event.clientY, entry }
}

async function forkToOverride() {
  const entry = menu.value.entry
  closeMenu()
  if (!entry) return
  try {
    const { content } = await props.baseFs.getFile(entry.path)
    const header = buildForkHeader(entry.path, entry.sha)
    const forked = header + (content ?? '')
    await props.overlayFs.putFile({
      path: entry.path,
      content: forked,
      message: `fork ${entry.path} to overlay override`,
    })
    emit('fork', { path: entry.path, baseSha: entry.sha })
    await refresh()
    emit('select', { path: entry.path, fsKind: 'overlay' })
  } catch (e) {
    loadError.value = e
  }
}

function onRowClick(entry) {
  emit('select', {
    path: entry.path,
    fsKind: entry.marker === 'base' ? 'base' : 'overlay',
  })
}

function markerGlyph(marker) {
  if (marker === 'overlay') return 'circle-solid'
  if (marker === 'overlay_override') return 'circle-ring-dot'
  return 'dot'
}
</script>

<template>
  <div class="file-tree flex flex-col h-full overflow-hidden" @click="closeMenu">
    <div class="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-base-content/60 flex items-center justify-between">
      <span>{{ $t ? $t('configTab.files') : 'Files' }}</span>
      <button
        class="btn btn-ghost btn-xs"
        :aria-label="$t ? $t('configTab.refresh') : 'Refresh'"
        @click.stop="refresh"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582M20 20v-5h-.581m-.942-4.001A7.002 7.002 0 005.07 9M19 15a7.002 7.002 0 01-13.419 1.997" />
        </svg>
      </button>
    </div>

    <div v-if="loading" class="px-2 py-1 text-xs text-base-content/60">…</div>
    <div v-else-if="loadError" class="px-2 py-1 text-xs text-error">
      {{ String(loadError.message || loadError) }}
    </div>

    <ul v-else class="flex-1 overflow-y-auto text-sm" data-testid="file-tree-list">
      <li
        v-for="entry in merged"
        :key="entry.path"
        class="flex items-center gap-2 px-2 py-0.5 cursor-pointer hover:bg-base-200"
        :class="{
          'bg-base-300': entry.path === selectedPath,
        }"
        :data-marker="entry.marker"
        :data-path="entry.path"
        @click="onRowClick(entry)"
        @contextmenu="openMenu($event, entry)"
      >
        <span
          class="inline-flex w-3 h-3 items-center justify-center text-[10px]"
          :data-glyph="markerGlyph(entry.marker)"
          :title="entry.marker"
        >
          <template v-if="entry.marker === 'overlay'">&#9679;</template>
          <template v-else-if="entry.marker === 'overlay_override'">&#9678;</template>
          <template v-else>&middot;</template>
        </span>
        <span
          v-if="driftMap[entry.path] === 'drift'"
          class="w-2 h-2 rounded-full bg-warning"
          :title="$t ? $t('configTab.drift') : 'Drift'"
        />
        <span class="truncate font-mono">{{ entry.path }}</span>
      </li>
    </ul>

    <ul
      v-if="menu.open"
      class="menu menu-sm rounded-box bg-base-100 shadow border border-base-300 fixed z-50"
      :style="{ top: menu.y + 'px', left: menu.x + 'px' }"
      role="menu"
      @click.stop
    >
      <li>
        <button
          type="button"
          role="menuitem"
          class="text-left"
          @click="forkToOverride"
        >
          {{ $t ? $t('configTab.forkToOverride') : 'Fork to override' }}
        </button>
      </li>
    </ul>
  </div>
</template>

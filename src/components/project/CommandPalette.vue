<script setup>
/**
 * Command palette (Ctrl/Cmd-P) — fuzzy search across current project's
 * nodes, attachments, and config files. Parent view wires `useHotkeys` to
 * toggle `open`; this component handles its own keyboard navigation and
 * emits `jumpTo` on selection.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { fuzzyFilter } from '@/composables/useProblems'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  items: {
    // Array<PaletteItem>
    type: Array,
    default: () => [],
  },
})
const emit = defineEmits(['close', 'jumpTo', 'update:open'])

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref(null)

const filtered = computed(() => fuzzyFilter(props.items, query.value.trim(), 30))

watch(filtered, () => {
  // clamp selection when results change
  if (selectedIndex.value >= filtered.value.length) {
    selectedIndex.value = Math.max(0, filtered.value.length - 1)
  }
})

watch(
  () => props.open,
  async (open) => {
    if (open) {
      query.value = ''
      selectedIndex.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  },
  { immediate: true },
)

function close() {
  emit('update:open', false)
  emit('close')
}

function chooseIndex(i) {
  const item = filtered.value[i]
  if (!item) return
  if (item.jumpTo) emit('jumpTo', item.jumpTo)
  close()
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    chooseIndex(selectedIndex.value)
  }
}

function kindBadge(kind) {
  switch (kind) {
    case 'node': return 'badge-primary'
    case 'attachment': return 'badge-accent'
    case 'file': return 'badge-info'
    case 'command': return 'badge-secondary'
    default: return ''
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="palette-backdrop fixed inset-0 z-[1000] flex items-start justify-center pt-24 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
      @click.self="close"
    >
      <div class="palette-card w-full max-w-xl bg-base-100 rounded-lg shadow-2xl border border-base-300">
        <div class="px-3 py-2 border-b border-base-300">
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            class="input input-sm w-full border-0 focus:outline-none"
            placeholder="Search nodes, attachments, files…"
            data-testid="command-palette-input"
            @keydown="onKey"
          />
        </div>
        <ul class="max-h-80 overflow-y-auto">
          <li
            v-for="(item, i) in filtered"
            :key="item.id"
            class="px-3 py-2 flex items-center gap-2 cursor-pointer"
            :class="{ 'bg-primary/10': i === selectedIndex }"
            :data-testid="`palette-result-${item.id}`"
            @mousemove="selectedIndex = i"
            @click="chooseIndex(i)"
          >
            <span class="badge badge-sm" :class="kindBadge(item.kind)">{{ item.kind }}</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ item.label }}</div>
              <div v-if="item.subtitle" class="text-[11px] opacity-60 truncate font-mono">{{ item.subtitle }}</div>
            </div>
          </li>
          <li
            v-if="!filtered.length"
            class="px-3 py-6 text-center text-sm opacity-60"
            data-testid="palette-empty"
          >
            No matches.
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

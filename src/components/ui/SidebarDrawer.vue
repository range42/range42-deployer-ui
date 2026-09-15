<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ id?: string; open: boolean; title: string; closeLabel: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousOverflow: string | undefined

function unlockScroll() {
  if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow
  previousOverflow = undefined
}

watch(() => props.open, async open => {
  await nextTick()
  if (open !== props.open || !dialog.value) return
  if (open && !dialog.value.open) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.value.showModal()
  } else if (!open) {
    if (dialog.value.open) dialog.value.close()
    unlockScroll()
  }
}, { immediate: true })

function containTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = Array.from(dialog.value.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, [tabindex]'))
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

function closeFromBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) emit('close')
}

onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close(); unlockScroll() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" :id="id" v-bind="$attrs" class="sidebar-drawer" :aria-label="title" @keydown="containTab" @cancel.prevent="emit('close')" @close="emit('close')" @click="closeFromBackdrop">
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-base-300 px-4 py-3">
        <h2 class="text-sm font-semibold">{{ title }}</h2>
        <button type="button" class="btn btn-ghost btn-square min-h-11 h-11" :aria-label="closeLabel" autofocus @click="emit('close')">
          <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain"><slot /></div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.sidebar-drawer { position: fixed; inset: 0 auto 0 0; width: min(22rem, calc(100vw - 1rem)); max-width: none; height: 100dvh; max-height: none; margin: 0; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); border: 0; border-right: 1px solid var(--color-base-300); background: var(--color-base-100); color: var(--color-base-content); box-shadow: 12px 0 40px rgb(0 0 0 / .15); }
.sidebar-drawer[open] { display: flex; flex-direction: column; }
:deep(.project-sidebar) { width: 100%; border-right: 0; }
.sidebar-drawer::backdrop { background: rgb(0 0 0 / .5); }
</style>

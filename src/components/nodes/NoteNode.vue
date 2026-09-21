<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{
  data: { config?: { name?: string; text?: string; color?: string } }
  selected?: boolean
  sourcePosition?: Position
  targetPosition?: Position
}>()
const { t } = useI18n()
const tone = computed(() => ['yellow', 'blue', 'green', 'neutral'].includes(props.data.config?.color || '')
  ? props.data.config!.color : 'yellow')
</script>

<template>
  <section class="canvas-note" :data-color="tone" :class="{ 'ring-2 ring-primary': selected }">
    <NodeResizer :is-visible="selected" :min-width="220" :min-height="120" :max-width="1200" :max-height="900" />
    <header class="flex items-start gap-2 border-b border-current/15 pb-2">
      <AppIcon name="document" class="size-5 shrink-0" />
      <h3 class="min-w-0 break-words font-semibold">{{ data.config?.name || t('sidebar.items.note.label') }}</h3>
    </header>
    <p class="note-text nodrag nowheel mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words select-text">{{ data.config?.text || t('configPanel.note.empty') }}</p>
    <Handle type="target" :position="targetPosition || Position.Top" />
    <Handle type="source" :position="sourcePosition || Position.Bottom" />
  </section>
</template>

<style scoped>
.canvas-note { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 120px; padding: 1rem; border: 1px solid #d1a445; border-radius: .75rem; background: #fffbeb; color: #713f12; box-shadow: 0 2px 8px #0000000a; }
.canvas-note[data-color="blue"] { background: #eff6ff; border-color: #93b4de; color: #1e3a5f; }
.canvas-note[data-color="green"] { background: #f0fdf4; border-color: #8bbba0; color: #14532d; }
.canvas-note[data-color="neutral"] { background: #f8fafc; border-color: #94a3b8; color: #334155; }
:global([data-theme="dark"]) .canvas-note { background: #332b17; border-color: #927944; color: #fef3c7; }
:global([data-theme="dark"]) .canvas-note[data-color="blue"] { background: #1c2c43; border-color: #6686b0; color: #dbeafe; }
:global([data-theme="dark"]) .canvas-note[data-color="green"] { background: #1a3325; border-color: #609578; color: #dcfce7; }
:global([data-theme="dark"]) .canvas-note[data-color="neutral"] { background: #283344; border-color: #78889f; color: #f1f5f9; }
.note-text { font-size: .875rem; line-height: 1.5; }
</style>

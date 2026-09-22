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
  <section class="canvas-note" :data-color="tone" >
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
.canvas-note { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 120px; padding: 1rem; border: 1px solid light-dark(#d1a445, #927944); border-radius: .75rem; background: light-dark(#fffbeb, #332b17); color: light-dark(#713f12, #fef3c7); box-shadow: 0 2px 8px #0000000a; }
.canvas-note[data-color="blue"] { background: light-dark(#eff6ff, #1c2c43); border-color: light-dark(#93b4de, #6686b0); color: light-dark(#1e3a5f, #dbeafe); }
.canvas-note[data-color="green"] { background: light-dark(#f0fdf4, #1a3325); border-color: light-dark(#8bbba0, #609578); color: light-dark(#14532d, #dcfce7); }
.canvas-note[data-color="neutral"] { background: light-dark(#f8fafc, #283344); border-color: light-dark(#94a3b8, #78889f); color: light-dark(#334155, #f1f5f9); }
.note-text { font-size: .875rem; line-height: 1.5; overscroll-behavior: contain; }
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlatformPlan } from '@/services/platformComponents'
const props = defineProps<{ data: { label?: string; config?: { plan?: PlatformPlan } }; selected?: boolean }>()
const emit = defineEmits<{ deploy: []; files: [] }>()
const plan = computed(() => props.data.config?.plan)
</script>
<template>
  <article class="w-full h-full rounded-xl border-2 border-dashed bg-base-200/40" :class="selected ? 'border-primary' : 'border-base-300'" data-testid="platform-stack-node">
    <header class="m-4 rounded-lg bg-base-100 p-3 flex items-center justify-between gap-4">
      <div><p class="text-xs text-base-content/70">Range42 stack · {{ plan?.vms.length }} VMs</p><h3 class="font-semibold">{{ data.label }}</h3><p class="text-sm">{{ plan?.domain }}</p></div>
      <div class="nodrag nopan flex gap-2">
        <button type="button" class="btn btn-primary btn-sm" @click.stop="emit('deploy')">Deploy stack</button>
        <button type="button" class="btn btn-ghost btn-sm" @click.stop="emit('files')">Stack files</button>
      </div>
    </header>
  </article>
</template>

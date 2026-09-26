<script setup lang="ts">
import { computed } from 'vue'
import type { PlatformPlan } from '@/services/platformComponents'
const props = defineProps<{ data: { label?: string; config?: { plan?: PlatformPlan } }; selected?: boolean }>()
const emit = defineEmits<{ deploy: []; files: [] }>()
const plan = computed(() => props.data.config?.plan)
</script>
<template>
  <article class="w-80 rounded-xl border-2 bg-base-100 shadow-md p-4" :class="selected ? 'border-primary' : 'border-base-300'" data-testid="platform-stack-node">
    <p class="text-xs text-base-content/70">Range42 stack</p>
    <h3 class="mt-1 font-semibold">{{ data.label }}</h3>
    <p class="mt-1 text-sm break-all">{{ plan?.domain }}</p>
    <p class="text-xs mt-2">{{ plan?.vms.length }} VMs · {{ plan?.subnet }}</p>
    <p class="mt-2 text-xs leading-relaxed">{{ plan?.vms.map(vm => vm.service).join(' · ') }}</p>
    <div class="nodrag nopan flex gap-2 mt-4">
      <button type="button" class="btn btn-primary btn-sm" @click.stop="emit('deploy')">Deploy stack</button>
      <button type="button" class="btn btn-ghost btn-sm" @click.stop="emit('files')">Stack files</button>
    </div>
  </article>
</template>

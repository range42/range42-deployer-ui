<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
defineProps<{ data: { label?: string; config?: Record<string, unknown> }; network?: boolean; selected?: boolean }>()
</script>
<template>
  <article class="w-[270px] rounded-lg border-2 bg-base-100 p-3 shadow-sm" :class="selected ? 'border-primary' : network ? 'border-info/50' : 'border-base-300'" :data-testid="network ? 'platform-network-node' : 'platform-vm-node'">
    <Handle v-if="!network" type="target" :position="Position.Top" :connectable="false" />
    <p class="text-xs text-base-content/60">{{ network ? 'Private network' : `VM ${data.config?.vm_id}` }}</p>
    <h4 class="font-semibold">{{ data.label }}</h4>
    <p class="text-sm font-mono">{{ network ? data.config?.subnet : data.config?.ip }}</p>
    <p class="text-xs text-base-content/70 mt-1">{{ network ? `Gateway ${data.config?.gateway || ''}` : data.config?.name }}</p>
    <p v-if="!network && data.config?.template_vmid" class="text-xs text-base-content/70">Template {{ data.config.template_vmid }}</p>
    <Handle v-if="network" type="source" :position="Position.Bottom" :connectable="false" />
  </article>
</template>

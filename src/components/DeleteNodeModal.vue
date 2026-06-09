<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  open: { type: Boolean, default: false },
  node: { type: Object, required: true },
})
const emit = defineEmits(['deleteProxmox', 'removeCanvas', 'cancel'])
const { t } = useI18n()

const name = computed(() => props.node?.data?.name || props.node?.type || 'node')
const canProxmoxDelete = computed(() => {
  const n = props.node
  return ['vm', 'lxc'].includes(n?.type) && n?.data?.deployed === true && n?.data?.vmId != null
})
const isRunning = computed(() => props.node?.data?.status === 'running')
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal modal-open z-[200]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-node-title"
      tabindex="-1"
      @keydown.esc.prevent="emit('cancel')"
    >
      <div class="modal-box">
        <h3 id="delete-node-title" class="font-semibold text-lg">{{ t('project.deleteNode.title') }}</h3>
        <p class="py-2 text-sm">
          {{ canProxmoxDelete ? t('project.deleteNode.promptProxmox', { name }) : t('project.deleteNode.promptCanvas', { name }) }}
        </p>
        <p v-if="canProxmoxDelete" class="text-xs opacity-70">{{ t('project.deleteNode.destroyWarning') }}</p>
        <p v-if="canProxmoxDelete && isRunning" class="text-xs text-warning mt-1">
          {{ t('project.deleteNode.mustStopFirst') }}
        </p>
        <div class="modal-action flex-wrap gap-2">
          <button
            v-if="canProxmoxDelete"
            class="btn btn-error"
            data-testid="delete-proxmox"
            :disabled="isRunning"
            @click="emit('deleteProxmox')"
          >{{ t('project.deleteNode.deleteFromProxmox') }}</button>
          <button
            class="btn btn-outline"
            data-testid="remove-canvas"
            @click="emit('removeCanvas')"
          >{{ canProxmoxDelete ? t('project.deleteNode.removeCanvasOnly') : t('project.deleteNode.remove') }}</button>
          <button class="btn btn-ghost" data-testid="cancel" @click="emit('cancel')">
            {{ t('project.deleteNode.cancel') }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="emit('cancel')"></div>
    </div>
  </Teleport>
</template>

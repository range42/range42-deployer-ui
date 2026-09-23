<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  open: { type: Boolean, default: false },
  node: { type: Object, required: true },
  descendantCount: { type: Number, default: 0 },
})
const emit = defineEmits(['deleteProxmox', 'removeCanvas', 'cancel'])
const { t } = useI18n()

const dialog = ref(null)
const cancelButton = ref(null)
const focusReady = ref(false)
watch(() => props.open, async open => {
  focusReady.value = false
  if (open) {
    await nextTick()
    if (props.open) focusReady.value = true
  }
}, { immediate: true })
const isGroup = computed(() => props.node?.type === 'group')
const name = computed(() => props.node?.data?.config?.name || props.node?.data?.name || props.node?.type || 'node')
const canProxmoxDelete = computed(() => {
  const n = props.node
  return ['vm', 'lxc'].includes(n?.type) && n?.data?.deployed === true && n?.data?.vmId != null
})
const isRunning = computed(() => props.node?.data?.status === 'running')
</script>

<template>
  <Teleport to="body">
    <FocusTrap v-if="open" :active="focusReady" :initial-focus="() => cancelButton"
      :fallback-focus="() => dialog" :escape-deactivates="false" :return-focus-on-deactivate="false">
    <div
      class="modal modal-open z-[1000]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-node-title"
      tabindex="-1"
      @keydown.esc.stop.prevent="emit('cancel')"
    >
      <div ref="dialog" class="modal-box" tabindex="-1">
        <h3 id="delete-node-title" class="font-semibold text-lg">{{ t(isGroup ? 'project.deleteNode.groupTitle' : 'project.deleteNode.title') }}</h3>
        <p class="py-2 text-sm">
          {{ isGroup ? t('project.deleteNode.promptGroup', { name, count: descendantCount }) : canProxmoxDelete ? t('project.deleteNode.promptProxmox', { name }) : t('project.deleteNode.promptCanvas', { name }) }}
        </p>
        <p v-if="isGroup" class="text-sm text-base-content/75">{{ t('project.deleteNode.groupHelp') }}</p>
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
          >{{ isGroup ? t('project.deleteNode.groupOnly') : canProxmoxDelete ? t('project.deleteNode.removeCanvasOnly') : t('project.deleteNode.remove') }}</button>
          <button v-if="isGroup && descendantCount > 0" type="button" class="btn btn-error"
            data-testid="remove-group-recursive" @click="emit('removeCanvas', { recursive: true })">
            {{ t('project.deleteNode.groupRecursive') }}
          </button>
          <button ref="cancelButton" type="button" class="btn btn-ghost" data-testid="cancel" @click="emit('cancel')">
            {{ t('project.deleteNode.cancel') }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="emit('cancel')"></div>
    </div>
    </FocusTrap>
  </Teleport>
</template>

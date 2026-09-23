<script setup>
import { useI18n } from 'vue-i18n'
import SetupChecklist from '@/components/ui/SetupChecklist.vue'

defineProps({
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])
const { t } = useI18n()
</script>

<template>
  <div v-if="visible" class="modal modal-open" data-testid="setup-wizard-modal">
    <div class="modal-box max-w-2xl">
      <div class="flex items-center justify-between mb-1">
        <h3 class="font-bold text-lg">{{ t('home.wizard.title') }}</h3>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          :aria-label="t('home.wizard.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <p class="text-sm text-base-content/70 mb-4">{{ t('home.welcome_sub') }}</p>
      <!-- Navigating from a step closes the modal (router leaves Home). -->
      <SetupChecklist @navigate="emit('close')" />
    </div>
    <div class="modal-backdrop" @click="emit('close')"></div>
  </div>
</template>

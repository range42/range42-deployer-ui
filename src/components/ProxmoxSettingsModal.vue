<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useProxmoxSettings, DEFAULT_BACKEND_API_URL } from '../composables/useProxmoxSettings'
import FormField from '@/components/ui/FormField.vue'
import FormSection from '@/components/ui/FormSection.vue'

const DEFAULT_API_URL = DEFAULT_BACKEND_API_URL

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  projectId: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['close', 'saved'])

const modalRef = ref(null)

const {
  baseUrl: currentBaseUrl,
  defaultNode: currentDefaultNode,
  isConfigured,
  updatedAt,
  updateSettings,
  resetSettings
} = useProxmoxSettings(computed(() => props.projectId))

const formBaseUrl = ref('')
const formDefaultNode = ref('')
const isSaving = ref(false)
const saveError = ref(null)

const populateForm = () => {
  formBaseUrl.value = currentBaseUrl.value || DEFAULT_API_URL
  formDefaultNode.value = currentDefaultNode.value || ''
  saveError.value = null
}

const openDialog = async () => {
  await nextTick()
  const dialog = modalRef.value
  if (dialog && !dialog.open) {
    dialog.showModal()
  }
}

const closeDialog = () => {
  const dialog = modalRef.value
  if (dialog && dialog.open) {
    dialog.close()
  }
}

const handleDialogClose = () => {
  if (props.visible) {
    emit('close')
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      populateForm()
      openDialog()
    } else {
      closeDialog()
    }
  },
  { immediate: true }
)

watch(
  () => modalRef.value,
  (dialog, previousDialog) => {
    if (previousDialog) {
      previousDialog.removeEventListener('close', handleDialogClose)
    }
    if (dialog) {
      dialog.addEventListener('close', handleDialogClose)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  const dialog = modalRef.value
  if (dialog) {
    dialog.removeEventListener('close', handleDialogClose)
  }
  closeDialog()
})

const isFormValid = computed(() => {
  return formBaseUrl.value.trim() !== '' && formDefaultNode.value.trim() !== ''
})

const handleSave = async () => {
  if (!isFormValid.value) {
    saveError.value = 'Both Base URL and Default Node are required'
    return
  }

  isSaving.value = true
  saveError.value = null

  try {
    const success = updateSettings(formBaseUrl.value.trim(), formDefaultNode.value.trim())
    if (success) {
      emit('saved')
      emit('close')
      closeDialog()
    } else {
      saveError.value = 'Failed to save settings. Please try again.'
    }
  } catch (error) {
    const message = error && error.message ? error.message : 'An error occurred while saving'
    saveError.value = message
  } finally {
    isSaving.value = false
  }
}

const handleReset = () => {
  if (confirm('Are you sure you want to reset Proxmox settings for this project?')) {
    resetSettings()
    populateForm()
  }
}

const handleClose = () => {
  emit('close')
  closeDialog()
}

const formatDate = (isoString) => {
  if (!isoString) return 'Never'
  const date = new Date(isoString)
  return date.toLocaleString()
}
</script>

<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">⚙️ Proxmox Configuration</h3>
      
      <!-- Info Alert -->
      <div class="alert alert-info mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div class="text-sm">
          <p class="font-semibold">Backend API Connection Settings</p>
          <p class="text-xs opacity-80">Configure the Range42 Backend API that connects to your Proxmox cluster. Settings are stored locally per project.</p>
        </div>
      </div>

      <!-- Current Status -->
      <div v-if="isConfigured" class="stats shadow mb-4 w-full">
        <div class="stat">
          <div class="stat-title">Configuration Status</div>
          <div class="stat-value text-success text-sm">✓ Configured</div>
          <div class="stat-desc">Last updated: {{ formatDate(updatedAt) }}</div>
        </div>
      </div>

      <div v-else class="alert alert-warning mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <span class="text-sm">Proxmox settings not configured. Please configure before using Proxmox operations.</span>
      </div>

      <!-- Form -->
      <FormSection variant="bordered" :columns="1" class="mb-4">
        <FormField
          v-model="formBaseUrl"
          label="Backend API URL"
          type="text"
          placeholder="http://127.0.0.1:8000"
          :required="true"
          :error="saveError && !formBaseUrl.trim() ? 'Required' : ''"
          hint="URL of the Range42 Backend API service (e.g., http://192.168.1.100:8000)"
          icon=""
        />
        <FormField
          v-model="formDefaultNode"
          label="Proxmox Node"
          type="text"
          placeholder="pve"
          :required="true"
          :error="saveError && !formDefaultNode.trim() ? 'Required' : ''"
          hint="The Proxmox node name where VMs will be deployed (e.g., pve, px-testing, node1)"
          icon=""
        />
      </FormSection>

      <!-- Error Message -->
      <div v-if="saveError" class="alert alert-error mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{{ saveError }}</span>
      </div>

      <!-- Actions -->
      <div class="modal-action border-t border-base-300 pt-4">
        <div class="flex justify-between items-center w-full">
          <button 
            v-if="isConfigured" 
            class="btn btn-ghost btn-sm gap-1" 
            @click="handleReset"
            :disabled="isSaving"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset
          </button>
          <div v-else></div>
          <div class="flex gap-2">
            <button class="btn btn-ghost" type="button" @click="handleClose" :disabled="isSaving">Cancel</button>
            <button 
              class="btn btn-primary gap-1" 
              @click="handleSave"
              :disabled="!isFormValid || isSaving"
            >
              <span v-if="isSaving" class="loading loading-spinner loading-sm"></span>
              <template v-else>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Save Settings
              </template>
            </button>
          </div>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @submit.prevent="handleClose">
      <button>close</button>
    </form>
  </dialog>
</template>

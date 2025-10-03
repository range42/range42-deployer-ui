<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useProxmoxSettings, DEFAULT_PROXMOX_BASE_DOMAIN } from '../composables/useProxmoxSettings'

const DEFAULT_BASE_URL = DEFAULT_PROXMOX_BASE_DOMAIN

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
  formBaseUrl.value = currentBaseUrl.value || DEFAULT_BASE_URL
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
          <p class="font-semibold">Project-level Proxmox settings</p>
          <p class="text-xs opacity-80">These settings are stored locally in your browser and apply only to this project.</p>
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
      <div class="form-control mb-4">
        <label class="label">
          <span class="label-text font-semibold">Base Domain / IP</span>
          <span class="label-text-alt text-xs opacity-70">Proxmox API base domain</span>
        </label>
        <input 
          v-model="formBaseUrl" 
          type="text" 
          placeholder="http://127.0.0.1:8000" 
          class="input input-bordered w-full"
          :class="{ 'input-error': saveError && !formBaseUrl.trim() }"
        />
        <label class="label">
          <span class="label-text-alt text-xs opacity-70">
            The base domain/IP for Proxmox runner API (e.g., http://192.168.1.100:8000 or https://proxmox.example.com)
          </span>
        </label>
      </div>

      <div class="form-control mb-4">
        <label class="label">
          <span class="label-text font-semibold">Default Node</span>
          <span class="label-text-alt text-xs opacity-70">Target Proxmox node</span>
        </label>
        <input 
          v-model="formDefaultNode" 
          type="text" 
          placeholder="px-testing" 
          class="input input-bordered w-full"
          :class="{ 'input-error': saveError && !formDefaultNode.trim() }"
        />
        <label class="label">
          <span class="label-text-alt text-xs opacity-70">
            The default Proxmox node where VMs will be deployed (e.g., px-testing, pve-node-1)
          </span>
        </label>
      </div>

      <!-- Error Message -->
      <div v-if="saveError" class="alert alert-error mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{{ saveError }}</span>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <button 
          v-if="isConfigured" 
          class="btn btn-ghost btn-sm" 
          @click="handleReset"
          :disabled="isSaving"
        >
          Reset
        </button>
        <button class="btn" type="button" @click="handleClose" :disabled="isSaving">Cancel</button>
        <button 
          class="btn btn-primary" 
          @click="handleSave"
          :disabled="!isFormValid || isSaving"
        >
          <span v-if="isSaving" class="loading loading-spinner loading-sm"></span>
          <span v-else>Save Settings</span>
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @submit.prevent="handleClose">
      <button>close</button>
    </form>
  </dialog>
</template>

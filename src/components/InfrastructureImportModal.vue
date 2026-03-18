<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useInfrastructureImport } from '@/composables/useInfrastructureImport'
import { setBaseUrl } from '@/services/proxmox/api'

// Props — receive config from ProjectEditor (per-project settings)
const props = defineProps<{
  apiUrl?: string
  proxmoxNode?: string
}>()

// Emits
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'import', result: { nodes: unknown[]; edges: unknown[] }): void
}>()

// Composable
const {
  vms,
  lxcs,
  isLoading,
  error,
  selectedResources,
  fetchResources,
  toggleSelection,
  selectAll,
  deselectAll,
  importSelected,
  setNode,
} = useInfrastructureImport()

// Override isConfigured: use props instead of the broken global store
const isConfigured = computed(() => !!(props.apiUrl && props.proxmoxNode))

// Local state
const isImporting = ref(false)
const importError = ref<string | null>(null)
const activeTab = ref<'vms' | 'lxcs'>('vms')

// Actions
async function handleImport() {
  if (selectedResources.value.length === 0) {
    importError.value = 'Please select at least one resource to import'
    return
  }

  try {
    isImporting.value = true
    importError.value = null

    const result = await importSelected()

    if (result.success || result.nodes.length > 0) {
      emit('import', { nodes: result.nodes, edges: result.edges })
      emit('close')
    } else {
      importError.value = result.errors.join(', ') || 'Import failed'
    }
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err)
  } finally {
    isImporting.value = false
  }
}

function close() {
  emit('close')
}

function getStatusBadge(status: string | undefined) {
  switch (status) {
    case 'running':
      return 'badge-success'
    case 'stopped':
      return 'badge-error'
    case 'paused':
      return 'badge-warning'
    default:
      return 'badge-ghost'
  }
}

// Load on mount: configure API client from props and fetch
onMounted(() => {
  if (isConfigured.value) {
    setBaseUrl(String(props.apiUrl))
    setNode(String(props.proxmoxNode))
    fetchResources()
  }
})
</script>

<template>
  <div class="modal modal-open">
    <div class="modal-box max-w-3xl">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold flex items-center gap-2">
          <span>📥</span>
          Import Infrastructure
        </h2>
        <button class="btn btn-sm btn-circle btn-ghost" @click="close">✕</button>
      </div>

      <!-- Not Configured Warning -->
      <div v-if="!isConfigured" class="alert alert-warning mb-4">
        <span>⚠️ Proxmox connection not configured. Please configure your Proxmox settings first.</span>
      </div>

      <!-- Error Display -->
      <div v-if="error || importError" class="alert alert-error mb-4">
        <span>{{ error || importError }}</span>
      </div>

      <!-- Content -->
      <template v-if="isConfigured">
        <!-- Tabs -->
        <div class="tabs tabs-boxed mb-4">
          <a 
            class="tab" 
            :class="{ 'tab-active': activeTab === 'vms' }"
            @click="activeTab = 'vms'"
          >
            🖥️ VMs ({{ vms.length }})
          </a>
          <a 
            class="tab" 
            :class="{ 'tab-active': activeTab === 'lxcs' }"
            @click="activeTab = 'lxcs'"
          >
            📦 Containers ({{ lxcs.length }})
          </a>
        </div>

        <!-- Selection Controls -->
        <div class="flex gap-2 mb-4">
          <button class="btn btn-sm btn-ghost" @click="selectAll">Select All</button>
          <button class="btn btn-sm btn-ghost" @click="deselectAll">Deselect All</button>
          <button class="btn btn-sm btn-ghost" @click="fetchResources" :disabled="isLoading">
            <span v-if="isLoading" class="loading loading-spinner loading-xs"></span>
            <span v-else>🔄 Refresh</span>
          </button>
          <div class="flex-1"></div>
          <span class="text-sm text-base-content/60 self-center">
            {{ selectedResources.length }} selected
          </span>
        </div>

        <!-- Loading State -->
        <div v-if="isLoading" class="flex justify-center items-center py-12">
          <span class="loading loading-spinner loading-lg"></span>
        </div>

        <!-- VMs Tab -->
        <div v-else-if="activeTab === 'vms'" class="max-h-80 overflow-y-auto">
          <div v-if="vms.length === 0" class="text-center py-8 text-base-content/60">
            <p>No VMs found</p>
          </div>
          <div v-else class="space-y-2">
            <div 
              v-for="vm in vms" 
              :key="vm.id"
              class="flex items-center gap-3 p-3 border border-base-300 rounded-lg hover:bg-base-200 cursor-pointer transition-colors"
              :class="{ 'border-primary bg-primary/10': vm.selected }"
              @click="toggleSelection(vm.id)"
            >
              <input 
                type="checkbox" 
                class="checkbox checkbox-primary" 
                :checked="vm.selected"
                @click.stop
                @change="toggleSelection(vm.id)"
              />
              <div class="flex-1">
                <div class="font-medium">{{ vm.name }}</div>
                <div class="text-xs text-base-content/60">VMID: {{ vm.vmid }}</div>
              </div>
              <span class="badge badge-sm" :class="getStatusBadge(vm.status)">
                {{ vm.status }}
              </span>
            </div>
          </div>
        </div>

        <!-- LXCs Tab -->
        <div v-else-if="activeTab === 'lxcs'" class="max-h-80 overflow-y-auto">
          <div v-if="lxcs.length === 0" class="text-center py-8 text-base-content/60">
            <p>No containers found</p>
          </div>
          <div v-else class="space-y-2">
            <div 
              v-for="lxc in lxcs" 
              :key="lxc.id"
              class="flex items-center gap-3 p-3 border border-base-300 rounded-lg hover:bg-base-200 cursor-pointer transition-colors"
              :class="{ 'border-primary bg-primary/10': lxc.selected }"
              @click="toggleSelection(lxc.id)"
            >
              <input 
                type="checkbox" 
                class="checkbox checkbox-primary" 
                :checked="lxc.selected"
                @click.stop
                @change="toggleSelection(lxc.id)"
              />
              <div class="flex-1">
                <div class="font-medium">{{ lxc.name }}</div>
                <div class="text-xs text-base-content/60">VMID: {{ lxc.vmid }}</div>
              </div>
              <span class="badge badge-sm" :class="getStatusBadge(lxc.status)">
                {{ lxc.status }}
              </span>
            </div>
          </div>
        </div>
      </template>

      <!-- Footer -->
      <div class="modal-action border-t border-base-300 pt-4 mt-4">
        <div class="flex justify-between items-center w-full">
          <div class="text-sm text-base-content/60">
            {{ selectedResources.length }} resource(s) selected
          </div>
          <div class="flex gap-2">
            <button class="btn btn-ghost" @click="close">Cancel</button>
            <button
              class="btn btn-primary gap-1"
              :disabled="selectedResources.length === 0 || isImporting || !isConfigured"
              @click="handleImport"
            >
              <span v-if="isImporting" class="loading loading-spinner loading-xs"></span>
              <template v-else>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import {{ selectedResources.length }} Resource(s)
              </template>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop bg-black/50" @click="close"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useInventoryStore, type ComponentListItem } from '@/stores/inventoryStore'
import type { RegisteredInventory, InventoryComponent } from '@/services/git'

// Emits
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select-component', component: InventoryComponent, repoId: string): void
  (e: 'load-scenario', scenarioId: string, repoId: string): void
}>()

// Store
const inventoryStore = useInventoryStore()

// Local state
const newRepoUrl = ref('')
const addRepoError = ref<string | null>(null)
const isAddingRepo = ref(false)
const selectedRepo = ref<RegisteredInventory | null>(null)
const activeTab = ref<'vms' | 'networks' | 'services' | 'scenarios'>('vms')
const componentList = ref<ComponentListItem[]>([])
const loadingComponents = ref(false)
const selectedComponent = ref<InventoryComponent | null>(null)

// Computed
const hasRepos = computed(() => inventoryStore.repoCount > 0)

// ===========================================================================
// Repository Management
// ===========================================================================

async function addRepository() {
  if (!newRepoUrl.value.trim()) {
    addRepoError.value = 'Please enter a repository URL'
    return
  }

  try {
    isAddingRepo.value = true
    addRepoError.value = null
    
    await inventoryStore.addRepository(newRepoUrl.value.trim())
    newRepoUrl.value = ''
  } catch (err) {
    addRepoError.value = err instanceof Error ? err.message : String(err)
  } finally {
    isAddingRepo.value = false
  }
}

function removeRepository(repoId: string) {
  if (confirm('Remove this inventory repository?')) {
    inventoryStore.removeRepository(repoId)
    if (selectedRepo.value?.id === repoId) {
      selectedRepo.value = null
      componentList.value = []
    }
  }
}

async function selectRepository(repo: RegisteredInventory) {
  selectedRepo.value = repo
  await loadComponentList()
}

async function refreshRepository(repoId: string) {
  try {
    await inventoryStore.refreshRepository(repoId)
  } catch (err) {
    console.error('Failed to refresh repository:', err)
  }
}

// ===========================================================================
// Component Browsing
// ===========================================================================

async function loadComponentList() {
  if (!selectedRepo.value) return

  try {
    loadingComponents.value = true
    componentList.value = await inventoryStore.listComponents(selectedRepo.value.id, activeTab.value)
  } catch (err) {
    console.error('Failed to load components:', err)
    componentList.value = []
  } finally {
    loadingComponents.value = false
  }
}

async function selectComponent(item: ComponentListItem) {
  if (!selectedRepo.value) return

  try {
    const component = await inventoryStore.fetchComponent(selectedRepo.value.id, item.path)
    selectedComponent.value = component
  } catch (err) {
    console.error('Failed to fetch component:', err)
  }
}

function useComponent() {
  if (selectedComponent.value && selectedRepo.value) {
    emit('select-component', selectedComponent.value, selectedRepo.value.id)
    selectedComponent.value = null
  }
}

async function loadScenario(item: ComponentListItem) {
  if (!selectedRepo.value) return
  emit('load-scenario', item.id, selectedRepo.value.id)
}

// ===========================================================================
// Drag and Drop
// ===========================================================================

function handleDragStart(event: DragEvent, item: ComponentListItem) {
  if (!event.dataTransfer || !selectedRepo.value) return

  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/json', JSON.stringify({
    type: 'inventory-component',
    repoId: selectedRepo.value.id,
    path: item.path,
    componentType: item.type,
    componentId: item.id,
  }))
}

// ===========================================================================
// Tab Change
// ===========================================================================

async function changeTab(tab: 'vms' | 'networks' | 'services' | 'scenarios') {
  activeTab.value = tab
  await loadComponentList()
}

// ===========================================================================
// Helpers
// ===========================================================================

function getTypeIcon(type: string): string {
  switch (type) {
    case 'vm': return '🖥️'
    case 'lxc': return '📦'
    case 'network': return '🌐'
    case 'service': return '⚙️'
    case 'scenario': return '🗺️'
    default: return '📄'
  }
}

function close() {
  emit('close')
}

// Load on mount
onMounted(() => {
  // Auto-select first repo if available
  if (inventoryStore.registeredRepos.length > 0) {
    selectRepository(inventoryStore.registeredRepos[0])
  }
})
</script>

<template>
  <div class="modal modal-open">
    <div class="modal-box max-w-5xl h-[80vh] flex flex-col p-0">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-base-300">
        <h2 class="text-xl font-bold flex items-center gap-2">
          <span>📚</span>
          Inventory Browser
        </h2>
        <button class="btn btn-sm btn-circle btn-ghost" @click="close">✕</button>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <!-- Sidebar: Repository List -->
        <div class="w-64 border-r border-base-300 flex flex-col">
          <!-- Add Repository -->
          <div class="p-3 border-b border-base-300">
            <div class="flex gap-2">
              <input
                v-model="newRepoUrl"
                type="text"
                class="input input-bordered input-sm flex-1"
                placeholder="owner/repo"
                @keyup.enter="addRepository"
              />
              <button 
                class="btn btn-sm btn-primary"
                :disabled="isAddingRepo"
                @click="addRepository"
              >
                <span v-if="isAddingRepo" class="loading loading-spinner loading-xs"></span>
                <span v-else>+</span>
              </button>
            </div>
            <p v-if="addRepoError" class="text-xs text-error mt-1">{{ addRepoError }}</p>
          </div>

          <!-- Repository List -->
          <div class="flex-1 overflow-y-auto">
            <div v-if="!hasRepos" class="p-4 text-center text-base-content/60 text-sm">
              <p>No inventories added</p>
              <p class="mt-1">Add a GitHub repository above</p>
            </div>
            
            <div
              v-for="repo in inventoryStore.registeredRepos"
              :key="repo.id"
              class="p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors"
              :class="{ 'bg-primary/10 border-l-2 border-l-primary': selectedRepo?.id === repo.id }"
              @click="selectRepository(repo)"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-sm truncate">{{ repo.manifest.name }}</p>
                  <p class="text-xs text-base-content/60 truncate">{{ repo.id }}</p>
                </div>
                <div class="flex gap-1">
                  <button 
                    class="btn btn-xs btn-ghost"
                    title="Refresh"
                    @click.stop="refreshRepository(repo.id)"
                  >
                    🔄
                  </button>
                  <button 
                    class="btn btn-xs btn-ghost text-error"
                    title="Remove"
                    @click.stop="removeRepository(repo.id)"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div class="flex gap-2 mt-1">
                <span class="badge badge-xs">{{ repo.manifest.components.vms }} VMs</span>
                <span class="badge badge-xs">{{ repo.manifest.components.scenarios }} Scenarios</span>
                <span v-if="repo.isWritable" class="badge badge-xs badge-success">Write</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="flex-1 flex flex-col overflow-hidden">
          <template v-if="selectedRepo">
            <!-- Tabs -->
            <div class="tabs tabs-boxed bg-base-200 mx-4 mt-4">
              <a 
                class="tab" 
                :class="{ 'tab-active': activeTab === 'vms' }"
                @click="changeTab('vms')"
              >
                🖥️ VMs
              </a>
              <a 
                class="tab" 
                :class="{ 'tab-active': activeTab === 'networks' }"
                @click="changeTab('networks')"
              >
                🌐 Networks
              </a>
              <a 
                class="tab" 
                :class="{ 'tab-active': activeTab === 'services' }"
                @click="changeTab('services')"
              >
                ⚙️ Services
              </a>
              <a 
                class="tab" 
                :class="{ 'tab-active': activeTab === 'scenarios' }"
                @click="changeTab('scenarios')"
              >
                🗺️ Scenarios
              </a>
            </div>

            <!-- Component List -->
            <div class="flex-1 overflow-y-auto p-4">
              <div v-if="loadingComponents" class="flex justify-center py-8">
                <span class="loading loading-spinner loading-lg"></span>
              </div>

              <div v-else-if="componentList.length === 0" class="text-center py-8 text-base-content/60">
                <p>No {{ activeTab }} found in this inventory</p>
              </div>

              <div v-else class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div
                  v-for="item in componentList"
                  :key="item.id"
                  class="border border-base-300 rounded-lg p-3 hover:border-primary hover:bg-base-200 cursor-pointer transition-colors"
                  :draggable="activeTab !== 'scenarios'"
                  @click="activeTab === 'scenarios' ? loadScenario(item) : selectComponent(item)"
                  @dragstart="handleDragStart($event, item)"
                >
                  <div class="flex items-center gap-2">
                    <span class="text-lg">{{ getTypeIcon(item.type) }}</span>
                    <span class="font-medium text-sm truncate">{{ item.name }}</span>
                  </div>
                  <p class="text-xs text-base-content/60 mt-1 truncate">{{ item.id }}</p>
                  <div class="mt-2">
                    <span v-if="activeTab === 'scenarios'" class="badge badge-sm badge-primary">Load</span>
                    <span v-else class="badge badge-sm badge-ghost">Drag to canvas</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- No Repo Selected -->
          <div v-else class="flex-1 flex items-center justify-center text-base-content/60">
            <div class="text-center">
              <p class="text-4xl mb-4">📚</p>
              <p>Select an inventory from the sidebar</p>
              <p class="text-sm mt-2">or add a new one</p>
            </div>
          </div>
        </div>

        <!-- Component Detail Panel -->
        <div 
          v-if="selectedComponent"
          class="w-80 border-l border-base-300 flex flex-col"
        >
          <div class="flex items-center justify-between p-3 border-b border-base-300">
            <h3 class="font-semibold">Component Details</h3>
            <button class="btn btn-xs btn-ghost" @click="selectedComponent = null">✕</button>
          </div>
          
          <div class="flex-1 overflow-y-auto p-3 space-y-3">
            <div>
              <span class="text-3xl">{{ getTypeIcon(selectedComponent.type) }}</span>
            </div>
            
            <div>
              <p class="font-semibold text-lg">{{ selectedComponent.name }}</p>
              <p class="text-sm text-base-content/60">{{ selectedComponent.id }}</p>
            </div>
            
            <p class="text-sm">{{ selectedComponent.description }}</p>
            
            <div class="flex flex-wrap gap-1">
              <span 
                v-for="tag in selectedComponent.tags" 
                :key="tag" 
                class="badge badge-sm"
              >
                {{ tag }}
              </span>
            </div>
            
            <div class="divider my-2"></div>
            
            <div class="text-sm">
              <p class="font-medium mb-2">Configuration</p>
              <pre class="bg-base-200 p-2 rounded text-xs overflow-x-auto">{{ JSON.stringify(selectedComponent.config, null, 2) }}</pre>
            </div>
            
            <div v-if="selectedComponent.metadata" class="text-sm">
              <p class="font-medium mb-2">Metadata</p>
              <pre class="bg-base-200 p-2 rounded text-xs overflow-x-auto">{{ JSON.stringify(selectedComponent.metadata, null, 2) }}</pre>
            </div>
          </div>
          
          <div class="p-3 border-t border-base-300">
            <button class="btn btn-primary btn-sm w-full" @click="useComponent">
              Add to Canvas
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="p-4 border-t border-base-300 flex justify-between items-center">
        <div class="text-sm text-base-content/60">
          {{ inventoryStore.repoCount }} inventor{{ inventoryStore.repoCount === 1 ? 'y' : 'ies' }} registered
        </div>
        <button class="btn btn-ghost btn-sm" @click="close">Close</button>
      </div>
    </div>
    <div class="modal-backdrop" @click="close"></div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  background-color: rgba(0, 0, 0, 0.5);
}
</style>

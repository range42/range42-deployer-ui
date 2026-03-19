<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useProxmoxStorage } from '@/composables/useProxmoxStorage'
import type { TemplateInfo, IsoInfo } from '@/services/proxmox'

// Props
const props = defineProps<{
  mode?: 'template' | 'iso' | 'both'
  showDownload?: boolean
}>()

// Emits
const emit = defineEmits<{
  (e: 'select-template', template: TemplateInfo): void
  (e: 'select-iso', iso: IsoInfo): void
  (e: 'close'): void
}>()

// Composable
const {
  templates,
  isos,
  storagePools,
  isLoading,
  error,
  selectedStorage,
  groupedTemplates,
  templateStorages: _templateStorages,
  isoStorages: _isoStorages,
  loadAll,
  refresh,
  downloadIso,
  formatSize,
} = useProxmoxStorage()

// Local state
const activeTab = ref<'templates' | 'isos'>(props.mode === 'iso' ? 'isos' : 'templates')
const searchQuery = ref('')
const downloadUrl = ref('')
const downloadFilename = ref('')
const isDownloading = ref(false)

// Computed
const filteredTemplates = computed(() => {
  if (!searchQuery.value) return groupedTemplates.value
  
  const query = searchQuery.value.toLowerCase()
  const filtered: Record<string, TemplateInfo[]> = {}
  
  for (const [group, items] of Object.entries(groupedTemplates.value)) {
    const matches = items.filter(t => 
      t.name.toLowerCase().includes(query) || 
      t.volid.toLowerCase().includes(query)
    )
    if (matches.length > 0) {
      filtered[group] = matches
    }
  }
  
  return filtered
})

const filteredIsos = computed(() => {
  if (!searchQuery.value) return isos.value
  
  const query = searchQuery.value.toLowerCase()
  return isos.value.filter(iso => 
    iso.name.toLowerCase().includes(query) || 
    iso.volid.toLowerCase().includes(query)
  )
})

const showTemplatesTab = computed(() => props.mode !== 'iso')
const showIsosTab = computed(() => props.mode !== 'template')

// Actions
function selectTemplate(template: TemplateInfo) {
  emit('select-template', template)
}

function selectIso(iso: IsoInfo) {
  emit('select-iso', iso)
}

async function handleDownloadIso() {
  if (!downloadUrl.value || !downloadFilename.value) return
  
  try {
    isDownloading.value = true
    await downloadIso(downloadUrl.value, downloadFilename.value)
    downloadUrl.value = ''
    downloadFilename.value = ''
  } catch (err) {
    console.error('Failed to download ISO:', err)
  } finally {
    isDownloading.value = false
  }
}

function close() {
  emit('close')
}

// Load on mount
onMounted(() => {
  loadAll()
})
</script>

<template>
  <div class="template-browser bg-base-100 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-base-300">
      <h2 class="text-lg font-semibold flex items-center gap-2">
        <span>📦</span>
        Template & ISO Browser
      </h2>
      <button class="btn btn-sm btn-circle btn-ghost" @click="close">✕</button>
    </div>

    <!-- Storage Selector & Search -->
    <div class="p-4 border-b border-base-300 space-y-3">
      <div class="flex gap-3">
        <div class="form-control flex-1">
          <select v-model="selectedStorage" class="select select-bordered select-sm" @change="refresh">
            <option v-for="storage in storagePools" :key="storage.storage" :value="storage.storage">
              {{ storage.storage }} ({{ storage.type }})
            </option>
          </select>
        </div>
        <button class="btn btn-sm btn-ghost" @click="refresh" :disabled="isLoading">
          <span v-if="isLoading" class="loading loading-spinner loading-xs"></span>
          <span v-else>🔄</span>
        </button>
      </div>
      
      <input 
        v-model="searchQuery" 
        type="text" 
        class="input input-bordered input-sm w-full" 
        placeholder="Search templates and ISOs..."
      />
    </div>

    <!-- Tabs -->
    <div class="tabs tabs-boxed bg-base-200 mx-4 mt-4">
      <a 
        v-if="showTemplatesTab"
        class="tab" 
        :class="{ 'tab-active': activeTab === 'templates' }"
        @click="activeTab = 'templates'"
      >
        📀 Templates ({{ templates.length }})
      </a>
      <a 
        v-if="showIsosTab"
        class="tab" 
        :class="{ 'tab-active': activeTab === 'isos' }"
        @click="activeTab = 'isos'"
      >
        💿 ISOs ({{ isos.length }})
      </a>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">
      <!-- Error State -->
      <div v-if="error" class="alert alert-error mb-4">
        <span>{{ error }}</span>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="flex justify-center items-center py-8">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <!-- Templates Tab -->
      <div v-else-if="activeTab === 'templates'">
        <div v-if="Object.keys(filteredTemplates).length === 0" class="text-center py-8 text-base-content/60">
          <p>No templates found</p>
          <p class="text-sm mt-2">Upload templates to your Proxmox storage</p>
        </div>

        <div v-else class="space-y-4">
          <div v-for="(items, group) in filteredTemplates" :key="group">
            <h3 class="font-semibold text-sm text-base-content/70 mb-2">{{ group }}</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div 
                v-for="template in items" 
                :key="template.volid"
                class="border border-base-300 rounded-lg p-3 hover:border-primary hover:bg-base-200 cursor-pointer transition-colors"
                @click="selectTemplate(template)"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm truncate">{{ template.name }}</p>
                    <p class="text-xs text-base-content/60 truncate">{{ template.volid }}</p>
                  </div>
                  <span class="text-xs text-base-content/50 ml-2">{{ formatSize(template.size) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ISOs Tab -->
      <div v-else-if="activeTab === 'isos'">
        <div v-if="filteredIsos.length === 0" class="text-center py-8 text-base-content/60">
          <p>No ISOs found</p>
          <p class="text-sm mt-2">Upload ISOs to your Proxmox storage</p>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div 
            v-for="iso in filteredIsos" 
            :key="iso.volid"
            class="border border-base-300 rounded-lg p-3 hover:border-primary hover:bg-base-200 cursor-pointer transition-colors"
            @click="selectIso(iso)"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <p class="font-medium text-sm truncate">{{ iso.name }}</p>
                <p class="text-xs text-base-content/60 truncate">{{ iso.volid }}</p>
              </div>
              <span class="text-xs text-base-content/50 ml-2">{{ formatSize(iso.size) }}</span>
            </div>
          </div>
        </div>

        <!-- Download ISO Section -->
        <div v-if="showDownload" class="mt-6 pt-4 border-t border-base-300">
          <h4 class="font-semibold text-sm mb-3">Download ISO from URL</h4>
          <div class="space-y-2">
            <input 
              v-model="downloadUrl" 
              type="url" 
              class="input input-bordered input-sm w-full" 
              placeholder="https://example.com/image.iso"
            />
            <div class="flex gap-2">
              <input 
                v-model="downloadFilename" 
                type="text" 
                class="input input-bordered input-sm flex-1" 
                placeholder="filename.iso"
              />
              <button 
                class="btn btn-sm btn-primary"
                :disabled="!downloadUrl || !downloadFilename || isDownloading"
                @click="handleDownloadIso"
              >
                <span v-if="isDownloading" class="loading loading-spinner loading-xs"></span>
                <span v-else>Download</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-base-300 flex justify-end gap-2">
      <button class="btn btn-sm btn-ghost" @click="close">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.template-browser {
  min-height: 400px;
}
</style>

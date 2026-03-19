<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces, setLocale, getLocale } from '@/i18n/index.js'
import { SUPPORTED_LOCALES } from '@/i18n/supported.js'
import { useDragAndDrop } from '../composables/useDragAndDrop'

const props = defineProps(['project'])
const emit = defineEmits(['openExport', 'openDeploy', 'openValidate', 'openInventory', 'openTemplates', 'openImport'])
const { onDragStart } = useDragAndDrop()

const currentProject = computed(() => props.project)
const { t: _t } = useI18n({ useScope: 'global' })
const selectedLocale = ref(getLocale())

// Collapsible sections
const expandedSections = ref({
  components: true,
  actions: true,
  status: false,
})

const toggleSection = (section) => {
  expandedSections.value[section] = !expandedSections.value[section]
}

onMounted(async () => {
  await ensureNamespaces(['sidebar', 'common'])
})

const changeLocale = async () => {
  await setLocale(selectedLocale.value, ['sidebar', 'common'])
}

const infrastructureComponents = [
  {
    category: 'Compute',
    icon: '💻',
    items: [
      { type: 'vm', label: 'Virtual Machine', icon: '🖥️', shortcut: 'V' },
      { type: 'lxc', label: 'Container', icon: '📦', shortcut: 'C' },
    ]
  },
  {
    category: 'Network',
    icon: '🌐',
    items: [
      { type: 'network-segment', label: 'Network', icon: '🔗', shortcut: 'N' },
      { type: 'router', label: 'Router', icon: '🔀', shortcut: 'R' },
      { type: 'edge-firewall', label: 'Firewall', icon: '🛡️', shortcut: 'F' },
    ]
  },
  {
    category: 'Organization',
    icon: '📁',
    items: [
      { type: 'group', label: 'Group', icon: '📂', shortcut: 'G' },
    ]
  }
]

const openExport = () => emit('openExport')
const openDeploy = () => emit('openDeploy')
const openValidate = () => emit('openValidate')
const openInventory = () => emit('openInventory')
const openTemplates = () => emit('openTemplates')
const openImport = () => emit('openImport')

const nodeCount = computed(() => currentProject.value?.nodes?.length || 0)
const edgeCount = computed(() => currentProject.value?.edges?.length || 0)
</script>

<template>
  <aside class="w-72 h-full flex flex-col bg-base-200 border-r border-base-300">
    <!-- Header -->
    <div class="p-4 border-b border-base-300">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <span class="text-lg">🚀</span>
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-semibold text-sm truncate">{{ currentProject?.name || 'Untitled' }}</h2>
          <p class="text-xs text-base-content/50">{{ nodeCount }} nodes · {{ edgeCount }} connections</p>
        </div>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto no-scrollbar">
      <!-- Quick Actions -->
      <div class="p-3 border-b border-base-300/50">
        <div class="grid grid-cols-2 gap-2">
          <button class="btn btn-primary btn-sm gap-1.5" @click="openDeploy">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Deploy
          </button>
          <button class="btn btn-ghost btn-sm gap-1.5" @click="openValidate">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Validate
          </button>
        </div>
      </div>

      <!-- Components Section -->
      <div class="border-b border-base-300/50">
        <button 
          class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-base-300/30 transition-colors"
          @click="toggleSection('components')"
        >
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">Components</span>
          <svg 
            class="w-4 h-4 text-base-content/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.components }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </button>
        
        <div v-show="expandedSections.components" class="px-3 pb-3 space-y-3">
          <div v-for="category in infrastructureComponents" :key="category.category">
            <div class="flex items-center gap-2 mb-2 px-1">
              <span class="text-sm">{{ category.icon }}</span>
              <span class="text-xs font-medium text-base-content/50">{{ category.category }}</span>
            </div>
            
            <div class="space-y-1">
              <div
                v-for="component in category.items"
                :key="component.type"
                class="component-card flex items-center gap-3 group"
                :draggable="true"
                @dragstart="onDragStart($event, component.type)"
              >
                <div class="w-8 h-8 rounded-lg bg-base-200 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                  <span class="text-base">{{ component.icon }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-sm">{{ component.label }}</div>
                </div>
                <kbd class="kbd kbd-xs opacity-0 group-hover:opacity-50 transition-opacity">{{ component.shortcut }}</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Resources Section -->
      <div class="border-b border-base-300/50">
        <button 
          class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-base-300/30 transition-colors"
          @click="toggleSection('actions')"
        >
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">Resources</span>
          <svg 
            class="w-4 h-4 text-base-content/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.actions }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </button>
        
        <div v-show="expandedSections.actions" class="px-3 pb-3 space-y-1">
          <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-base-300/50 transition-colors text-left" @click="openInventory">
            <div class="w-8 h-8 rounded-lg bg-base-100 flex items-center justify-center">
              <span class="text-base">📚</span>
            </div>
            <div>
              <div class="font-medium text-sm">Inventory Browser</div>
              <div class="text-xs text-base-content/50">GitHub inventories</div>
            </div>
          </button>
          
          <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-base-300/50 transition-colors text-left" @click="openTemplates">
            <div class="w-8 h-8 rounded-lg bg-base-100 flex items-center justify-center">
              <span class="text-base">💿</span>
            </div>
            <div>
              <div class="font-medium text-sm">Templates & ISOs</div>
              <div class="text-xs text-base-content/50">Proxmox storage</div>
            </div>
          </button>
          
          <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-base-300/50 transition-colors text-left" @click="openImport">
            <div class="w-8 h-8 rounded-lg bg-base-100 flex items-center justify-center">
              <span class="text-base">📥</span>
            </div>
            <div>
              <div class="font-medium text-sm">Import Infrastructure</div>
              <div class="text-xs text-base-content/50">From Proxmox</div>
            </div>
          </button>
          
          <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-base-300/50 transition-colors text-left" @click="openExport">
            <div class="w-8 h-8 rounded-lg bg-base-100 flex items-center justify-center">
              <span class="text-base">📤</span>
            </div>
            <div>
              <div class="font-medium text-sm">Export Topology</div>
              <div class="text-xs text-base-content/50">JSON, YAML, Terraform</div>
            </div>
          </button>
        </div>
      </div>

      <!-- Status Legend -->
      <div>
        <button 
          class="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-base-300/30 transition-colors"
          @click="toggleSection('status')"
        >
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">Status Legend</span>
          <svg 
            class="w-4 h-4 text-base-content/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.status }"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </button>
        
        <div v-show="expandedSections.status" class="px-4 pb-4">
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="flex items-center gap-2">
              <span class="status-dot gray"></span>
              <span class="text-base-content/70">Incomplete</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="status-dot orange"></span>
              <span class="text-base-content/70">Ready</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="status-dot green"></span>
              <span class="text-base-content/70">Running</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="status-dot red"></span>
              <span class="text-base-content/70">Error</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="status-dot blue pulse"></span>
              <span class="text-base-content/70">Deploying</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="p-3 border-t border-base-300 bg-base-200">
      <div class="flex items-center justify-between">
        <select class="select select-ghost select-xs" v-model="selectedLocale" @change="changeLocale">
          <option v-for="l in SUPPORTED_LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
        </select>
        <div class="text-xs text-base-content/40">v0.1.0</div>
      </div>
    </div>
  </aside>
</template>

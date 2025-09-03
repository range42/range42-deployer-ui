<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces, setLocale, getLocale } from '@/i18n/index.js'
import { SUPPORTED_LOCALES } from '@/i18n/supported.js'
import { useDragAndDrop } from '../composables/useDragAndDrop'

const props = defineProps(['project'])
const emit = defineEmits(['openExport'])
const { onDragStart } = useDragAndDrop()

const currentProject = computed(() => props.project)
const { t } = useI18n({ useScope: 'global' })
const selectedLocale = ref(getLocale())

onMounted(async () => {
  await ensureNamespaces(['sidebar', 'common'])
})

const changeLocale = async () => {
  await setLocale(selectedLocale.value, ['sidebar', 'common'])
}

const infrastructureComponents = [
  {
    category: 'Compute & Virtualization',
    items: [
      {
        type: 'vm',
        label: 'Virtual Machine',
        icon: '🖥️',
        description: 'Deploy a virtual machine instance'
      },
      {
        type: 'docker',
        label: 'Container',
        icon: '🐳',
        description: 'Deploy a containerized application'
      }
    ]
  },
  {
    category: 'Network Infrastructure',
    items: [
      {
        type: 'network-segment',
        label: 'Network Segment',
        icon: '🌐',
        description: 'Create isolated network segment'
      },
      {
        type: 'router',
        label: 'Router',
        icon: '🔄',
        description: 'Layer 3 routing device'
      },
      {
        type: 'switch',
        label: 'Switch',
        icon: '🔀',
        description: 'Layer 2 switching device'
      },
      {
        type: 'firewall',
        label: 'Firewall',
        icon: '🔥',
        description: 'Network security appliance'
      }
    ]
  },
  {
    category: 'Network Services',
    items: [
      {
        type: 'dns',
        label: 'DNS Server',
        icon: '🔍',
        description: 'Domain name resolution'
      },
      {
        type: 'dhcp',
        label: 'DHCP Server',
        icon: '📋',
        description: 'Dynamic IP assignment'
      },
      {
        type: 'loadbalancer',
        label: 'Load Balancer',
        icon: '⚖️',
        description: 'Traffic distribution'
      }
    ]
  }
]

const openExport = () => {
  emit('openExport')
}
</script>

<template>
  <div class="w-80 bg-base-200 p-4 space-y-6">
    <!-- Header -->
    <div class="text-center">
      <h2 class="text-2xl font-bold">🏗️ {{ t('sidebar.title') }}</h2>
      <p class="text-sm opacity-70">{{ t('sidebar.subtitle') }}</p>
    </div>

    <!-- Language Switcher -->
    <div class="flex items-center justify-center gap-2">
      <label class="text-xs opacity-70">{{ t('sidebar.language.label') }}</label>
      <select class="select select-bordered select-xs" v-model="selectedLocale" @change="changeLocale">
        <option v-for="l in SUPPORTED_LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
      </select>
    </div>

    <!-- Project Info -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <h3 class="card-title text-sm">{{ t('sidebar.currentProject') }}</h3>
        <p class="text-xs opacity-70">{{ currentProject?.name || t('sidebar.untitledProject') }}</p>
        <div class="text-xs opacity-50">
          {{ t('sidebar.componentsCount', { count: currentProject?.nodes?.length || 0 }) }}
        </div>
      </div>
    </div>

    <!-- Infrastructure Components by Category -->
    <div class="space-y-4">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        {{ t('sidebar.infrastructure.title') }}
      </h3>
      
      <div v-for="category in infrastructureComponents" :key="category.category" class="space-y-2">
        <h4 class="text-xs font-medium opacity-60 uppercase tracking-wide">
          {{ category.category }}
        </h4>
        
        <div class="space-y-2">
          <div
            v-for="component in category.items"
            :key="component.type"
            class="card bg-base-100 shadow-sm cursor-grab hover:shadow-md transition-shadow border border-base-300 hover:border-primary/30"
            :draggable="true"
            @dragstart="onDragStart($event, component.type)"
          >
            <div class="card-body p-3">
              <div class="flex items-center space-x-3">
                <span class="text-xl">{{ component.icon }}</span>
                <div class="flex-1">
                  <div class="font-medium text-sm">{{ component.label }}</div>
                  <div class="text-xs opacity-70">{{ component.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Status Legend -->
    <div class="space-y-2">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        {{ t('sidebar.statusLegend.title') }}
      </h3>
      <div class="space-y-1 text-xs">
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-gray-400"></div>
          <span>{{ t('sidebar.statusLegend.incomplete') }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-orange-400"></div>
          <span>{{ t('sidebar.statusLegend.ready') }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-green-400"></div>
          <span>{{ t('sidebar.statusLegend.deployedRunning') }}</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-red-400"></div>
          <span>{{ t('sidebar.statusLegend.error') }}</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="space-y-2">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        {{ t('sidebar.quickActions.title') }}
      </h3>
      
      <div class="flex flex-col space-y-2">
        <button class="btn btn-sm btn-outline" @click="openExport">
          🧭 {{ t('sidebar.quickActions.export') }}
        </button>
        <button class="btn btn-sm btn-outline" disabled>
          🚀 {{ t('sidebar.quickActions.deploySoon') }}
        </button>
        <button class="btn btn-sm btn-outline" disabled>
          🔍 {{ t('sidebar.quickActions.validateSoon') }}
        </button>
      </div>
    </div>
  </div>
</template>

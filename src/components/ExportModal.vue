<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import { useExport } from '../composables/useExport'

// Accept project, visibility, and live graph overrides
const props = defineProps(['project', 'visible', 'nodes', 'edges'])
const emit = defineEmits(['close'])

// Use export composable (topology-only)
const { 
  isExporting, 
  exportErrors, 
  exportTopologyOnly,
  downloadTopology
} = useExport()

// Local state
const exportData = ref(null)
const currentStep = ref(1)

// i18n
const { t } = useI18n({ useScope: 'global' })
onMounted(() => {
  ensureNamespaces(['export', 'common'])
})

// Determine if we have nodes to export
const incomingNodesCount = computed(() => {
  const overridden = Array.isArray(props.nodes) ? props.nodes.length : 0
  if (overridden > 0) return overridden
  const proj = props.project
  return (proj && Array.isArray(proj.nodes)) ? proj.nodes.length : 0
})

// Actions
const handleExport = async () => {
  if (!props.project) return
  currentStep.value = 2
  exportData.value = await exportTopologyOnly(
    props.project,
    {
      nodes: Array.isArray(props.nodes) ? props.nodes : (props.project?.nodes || []),
      edges: Array.isArray(props.edges) ? props.edges : (props.project?.edges || [])
    }
  )
}

const handleDownload = () => {
  if (!exportData.value) return
  downloadTopology(exportData.value, props.project?.name)
  emit('close')
}

const resetModal = () => {
  currentStep.value = 1
  exportData.value = null
}

const handleClose = () => {
  resetModal()
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="modal modal-open">
    <div class="modal-box w-full max-w-3xl max-h-[90vh] overflow-y-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center space-x-3">
          <span class="text-3xl">🧭</span>
          <div>
            <h3 class="text-2xl font-bold">{{ t('export.title') }}</h3>
            <p class="text-sm opacity-70">{{ t('export.subtitle') }}</p>
          </div>
        </div>
        <button class="btn btn-sm btn-circle btn-ghost" @click="handleClose">✕</button>
      </div>

      <!-- Steps indicator (2 steps) -->
      <div class="steps w-full mb-8">
        <div class="step step-primary">{{ t('export.steps.generate') }}</div>
        <div class="step" :class="{ 'step-primary': currentStep >= 2 }">{{ t('export.steps.download') }}</div>
      </div>

      <!-- Step 1: Info & Generate -->
      <div v-if="currentStep === 1" class="space-y-6">
        <div class="alert alert-info">
          <div class="text-2xl">📄</div>
          <div>
            <h4 class="font-bold">{{ t('export.info.title') }}</h4>
            <p class="text-sm">{{ t('export.info.desc') }}</p>
          </div>
        </div>

        <div class="alert alert-warning" v-if="incomingNodesCount === 0">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <h4 class="font-bold">{{ t('export.empty.title') }}</h4>
            <p class="text-sm">{{ t('export.empty.desc') }}</p>
          </div>
        </div>

        <div class="flex justify-end">
          <button 
            class="btn btn-primary"
            @click="handleExport"
            :disabled="!project || incomingNodesCount === 0 || isExporting"
          >
            🚀 {{ t('export.cta.generate') }}
          </button>
        </div>
      </div>

      <!-- Step 2: Download -->
      <div v-if="currentStep === 2" class="space-y-6">
        <div class="text-center">
          <div v-if="isExporting" class="text-primary">
            <div class="loading loading-spinner loading-lg mb-4"></div>
            <div class="text-xl font-semibold">{{ t('export.generating') }}</div>
          </div>
          <div v-else-if="exportErrors.length > 0" class="text-error">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="text-xl font-semibold">{{ t('export.failed.title') }}</div>
          </div>
          <div v-else class="text-success">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <div class="text-xl font-semibold">{{ t('export.success.title') }}</div>
          </div>
        </div>

        <!-- Errors -->
        <div v-if="exportErrors.length > 0" class="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <h4 class="font-bold">{{ t('export.errors.title') }}</h4>
            <ul class="text-sm mt-2 space-y-1">
              <li v-for="error in exportErrors" :key="error">• {{ error }}</li>
            </ul>
          </div>
        </div>

        <!-- Summary -->
        <div v-if="exportData && !exportErrors.length" class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="stat bg-base-200 rounded-lg">
            <div class="stat-title">{{ t('export.stats.nodes') }}</div>
            <div class="stat-value text-lg">{{ exportData.metadata.nodeCount }}</div>
            <div class="stat-desc">{{ t('export.stats.nodesDesc') }}</div>
          </div>
          <div class="stat bg-base-200 rounded-lg">
            <div class="stat-title">{{ t('export.stats.edges') }}</div>
            <div class="stat-value text-lg">{{ exportData.metadata.edgeCount }}</div>
            <div class="stat-desc">{{ t('export.stats.edgesDesc') }}</div>
          </div>
          <div class="stat bg-base-200 rounded-lg">
            <div class="stat-title">{{ t('export.stats.hsn') }}</div>
            <div class="stat-value text-lg">
              {{ exportData.metadata.hostCount }} / {{ exportData.metadata.serviceCount }} / {{ exportData.metadata.networkCount }}
            </div>
            <div class="stat-desc">{{ t('export.stats.breakdown') }}</div>
          </div>
        </div>

        <div class="flex justify-end">
          <button 
            class="btn btn-primary"
            @click="handleDownload"
            :disabled="!exportData || isExporting"
          >
            ⬇️ {{ t('export.cta.download') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
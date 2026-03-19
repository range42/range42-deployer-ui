<script setup lang="ts">
import { computed } from 'vue'
import { useDeploymentStore } from '@/stores/deploymentStore'

const emit = defineEmits(['close'])

const deploymentStore = useDeploymentStore()

// Computed properties from store
const currentPlan = computed(() => deploymentStore.currentPlan)
const isDeploying = computed(() => deploymentStore.isDeploying)
const isPaused = computed(() => deploymentStore.isPaused)
const progress = computed(() => deploymentStore.progress)
const currentStep = computed(() => deploymentStore.currentStep)
const logs = computed(() => deploymentStore.logs)

// Status badge color
const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'badge-success'
    case 'running': return 'badge-info'
    case 'failed': return 'badge-error'
    case 'skipped': return 'badge-warning'
    default: return 'badge-ghost'
  }
}

// Log level color
const getLogColor = (level: string) => {
  switch (level) {
    case 'success': return 'text-success'
    case 'error': return 'text-error'
    case 'warning': return 'text-warning'
    default: return 'text-base-content'
  }
}

// Format timestamp
const formatTime = (iso: string) => {
  return new Date(iso).toLocaleTimeString()
}

// Actions
const handleStart = () => {
  deploymentStore.startDeployment()
}

const handlePause = () => {
  deploymentStore.pauseDeployment()
}

const handleCancel = () => {
  deploymentStore.cancelDeployment()
}

const handleReset = () => {
  deploymentStore.resetDeployment()
}

const handleRetry = (stepId: string) => {
  deploymentStore.retryStep(stepId)
}

const handleSkip = (stepId: string) => {
  deploymentStore.skipStep(stepId)
}

const handleClose = () => {
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div class="bg-base-100 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-base-300">
        <div>
          <h2 class="text-xl font-bold">🚀 Deployment</h2>
          <p class="text-sm opacity-70">{{ currentPlan?.name || 'No plan loaded' }}</p>
        </div>
        <button class="btn btn-sm btn-circle btn-ghost" @click="handleClose">✕</button>
      </div>

      <!-- Progress Bar -->
      <div class="p-4 border-b border-base-300">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">Progress</span>
          <span class="text-sm">{{ progress }}%</span>
        </div>
        <progress 
          class="progress w-full" 
          :class="currentPlan?.status === 'failed' ? 'progress-error' : 'progress-primary'"
          :value="progress" 
          max="100"
        ></progress>
        <div class="flex justify-between text-xs opacity-70 mt-1">
          <span>{{ deploymentStore.completedSteps.length }} / {{ currentPlan?.steps.length || 0 }} steps</span>
          <span v-if="currentStep">Current: {{ currentStep.name }}</span>
        </div>
      </div>

      <!-- Content: Split View -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Steps List -->
        <div class="w-1/2 border-r border-base-300 overflow-y-auto p-4">
          <h3 class="font-semibold mb-3">Deployment Steps</h3>
          <div class="space-y-2">
            <div 
              v-for="step in currentPlan?.steps" 
              :key="step.id"
              class="p-3 rounded-lg border"
              :class="{
                'border-info bg-info/10': step.status === 'running',
                'border-success bg-success/10': step.status === 'completed',
                'border-error bg-error/10': step.status === 'failed',
                'border-warning bg-warning/10': step.status === 'skipped',
                'border-base-300': step.status === 'pending'
              }"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span v-if="step.status === 'running'" class="loading loading-spinner loading-xs"></span>
                  <span v-else-if="step.status === 'completed'">✅</span>
                  <span v-else-if="step.status === 'failed'">❌</span>
                  <span v-else-if="step.status === 'skipped'">⏭️</span>
                  <span v-else>⏳</span>
                  <span class="font-medium text-sm">{{ step.name }}</span>
                </div>
                <span class="badge badge-sm" :class="getStatusColor(step.status)">
                  {{ step.status }}
                </span>
              </div>
              <p class="text-xs opacity-70 mt-1 ml-6">{{ step.description }}</p>
              
              <!-- Error message and retry/skip buttons -->
              <div v-if="step.status === 'failed'" class="mt-2 ml-6">
                <p class="text-xs text-error">{{ step.error }}</p>
                <div class="flex gap-2 mt-2">
                  <button 
                    class="btn btn-xs btn-outline btn-primary"
                    @click="handleRetry(step.id)"
                  >
                    Retry
                  </button>
                  <button 
                    class="btn btn-xs btn-outline btn-warning"
                    @click="handleSkip(step.id)"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Logs -->
        <div class="w-1/2 overflow-y-auto p-4 bg-base-200">
          <h3 class="font-semibold mb-3">Deployment Logs</h3>
          <div class="font-mono text-xs space-y-1">
            <div 
              v-for="(log, index) in logs" 
              :key="index"
              class="flex gap-2"
              :class="getLogColor(log.level)"
            >
              <span class="opacity-50 shrink-0">{{ formatTime(log.timestamp) }}</span>
              <span>{{ log.message }}</span>
            </div>
            <div v-if="logs.length === 0" class="text-center opacity-50 py-4">
              No logs yet. Start deployment to see progress.
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="p-4 border-t border-base-300 flex justify-between">
        <div>
          <button 
            v-if="currentPlan?.status === 'completed' || currentPlan?.status === 'failed'"
            class="btn btn-sm btn-outline"
            @click="handleReset"
          >
            🔄 Reset
          </button>
        </div>
        <div class="flex gap-2">
          <button 
            v-if="isDeploying && !isPaused"
            class="btn btn-sm btn-warning"
            @click="handlePause"
          >
            ⏸️ Pause
          </button>
          <button 
            v-if="isDeploying"
            class="btn btn-sm btn-error"
            @click="handleCancel"
          >
            ⏹️ Cancel
          </button>
          <button 
            v-if="!isDeploying || isPaused"
            class="btn btn-sm btn-primary"
            :disabled="!currentPlan || currentPlan.status === 'completed'"
            @click="handleStart"
          >
            {{ isPaused ? '▶️ Resume' : '🚀 Start Deployment' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

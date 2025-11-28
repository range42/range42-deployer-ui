/**
 * Deployment Store
 * 
 * Manages deployment state, executes deployment plans step by step,
 * and tracks progress. Provides real-time status updates.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { 
  proxmoxApi,
  type DeploymentPlan,
  type DeploymentStep,
} from '@/services/proxmox'
import { useProjectStore } from './projectStore'

// =============================================================================
// Types
// =============================================================================

export interface DeploymentLog {
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  stepId?: string
}

export interface DeploymentState {
  currentPlan: DeploymentPlan | null
  isDeploying: boolean
  isPaused: boolean
  logs: DeploymentLog[]
  startTime: string | null
  endTime: string | null
}

// =============================================================================
// Store
// =============================================================================

export const useDeploymentStore = defineStore('deployment', () => {
  // State
  const currentPlan = ref<DeploymentPlan | null>(null)
  const isDeploying = ref(false)
  const isPaused = ref(false)
  const logs = ref<DeploymentLog[]>([])
  const startTime = ref<string | null>(null)
  const endTime = ref<string | null>(null)

  // Abort controller for cancellation
  let abortController: AbortController | null = null

  // =============================================================================
  // Node Status Integration
  // =============================================================================

  /**
   * Update canvas node status based on deployment step result
   * Maps deployment status to node status colors
   */
  function updateNodeStatus(
    nodeId: string, 
    status: 'pending' | 'deploying' | 'running' | 'stopped' | 'error'
  ): void {
    if (!currentPlan.value?.projectId) return
    
    const projectStore = useProjectStore()
    projectStore.updateNodeStatus(currentPlan.value.projectId, nodeId, status)
  }

  // =============================================================================
  // Computed
  // =============================================================================

  const progress = computed(() => {
    if (!currentPlan.value) return 0
    const steps = currentPlan.value.steps
    const completed = steps.filter(s => s.status === 'completed').length
    return Math.round((completed / steps.length) * 100)
  })

  const currentStep = computed(() => {
    if (!currentPlan.value) return null
    return currentPlan.value.steps.find(s => s.status === 'running') || null
  })

  const completedSteps = computed(() => {
    if (!currentPlan.value) return []
    return currentPlan.value.steps.filter(s => s.status === 'completed')
  })

  const failedSteps = computed(() => {
    if (!currentPlan.value) return []
    return currentPlan.value.steps.filter(s => s.status === 'failed')
  })

  const pendingSteps = computed(() => {
    if (!currentPlan.value) return []
    return currentPlan.value.steps.filter(s => s.status === 'pending')
  })

  // =============================================================================
  // Logging
  // =============================================================================

  function addLog(
    level: DeploymentLog['level'],
    message: string,
    stepId?: string
  ) {
    logs.value.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      stepId,
    })
  }

  function clearLogs() {
    logs.value = []
  }

  // =============================================================================
  // Step Execution
  // =============================================================================

  async function executeStep(step: DeploymentStep): Promise<boolean> {
    step.status = 'running'
    step.startedAt = new Date().toISOString()
    addLog('info', `Starting: ${step.name}`, step.id)

    // Update node status to 'deploying'
    updateNodeStatus(step.nodeId, 'deploying')

    try {
      // Execute based on step type
      switch (step.type) {
        case 'create_bridge': {
          await proxmoxApi.network.addToNode(step.payload as Parameters<typeof proxmoxApi.network.addToNode>[0])
          break
        }

        case 'create_vm': {
          await proxmoxApi.vm.create(step.payload as Parameters<typeof proxmoxApi.vm.create>[0])
          break
        }

        case 'clone_template': {
          await proxmoxApi.vm.clone(step.payload as Parameters<typeof proxmoxApi.vm.clone>[0])
          break
        }

        case 'create_lxc': {
          await proxmoxApi.lxc.create(step.payload as Parameters<typeof proxmoxApi.lxc.create>[0])
          break
        }

        case 'configure_network': {
          await proxmoxApi.network.addToVm(step.payload as Parameters<typeof proxmoxApi.network.addToVm>[0])
          break
        }

        case 'add_firewall_rule': {
          await proxmoxApi.firewall.addRule(step.payload as Parameters<typeof proxmoxApi.firewall.addRule>[0])
          break
        }

        case 'start_vm': {
          const payload = step.payload as { proxmox_node: string; vm_id: number }
          await proxmoxApi.vm.start({
            proxmox_node: payload.proxmox_node,
            vm_id: payload.vm_id,
          })
          break
        }

        case 'start_lxc': {
          const payload = step.payload as { proxmox_node: string; vm_id: number }
          await proxmoxApi.lxc.start(payload.proxmox_node, payload.vm_id)
          break
        }

        default:
          addLog('warning', `Unknown step type: ${step.type}`, step.id)
      }

      step.status = 'completed'
      step.completedAt = new Date().toISOString()
      addLog('success', `Completed: ${step.name}`, step.id)
      
      // Update node status based on step type
      // For start_vm/start_lxc steps, mark as 'running'
      // For create steps, mark as 'stopped' (not started yet)
      const finalStatus = ['start_vm', 'start_lxc'].includes(step.type) ? 'running' : 'stopped'
      updateNodeStatus(step.nodeId, finalStatus)
      
      return true

    } catch (error) {
      step.status = 'failed'
      step.completedAt = new Date().toISOString()
      step.error = error instanceof Error ? error.message : String(error)
      addLog('error', `Failed: ${step.name} - ${step.error}`, step.id)
      
      // Update node status to 'error'
      updateNodeStatus(step.nodeId, 'error')
      
      return false
    }
  }

  // =============================================================================
  // Deployment Control
  // =============================================================================

  /**
   * Load a deployment plan
   */
  function loadPlan(plan: DeploymentPlan) {
    currentPlan.value = plan
    clearLogs()
    addLog('info', `Loaded deployment plan: ${plan.name}`)
  }

  /**
   * Start or resume deployment
   */
  async function startDeployment(): Promise<boolean> {
    if (!currentPlan.value) {
      addLog('error', 'No deployment plan loaded')
      return false
    }

    if (isDeploying.value && !isPaused.value) {
      addLog('warning', 'Deployment already in progress')
      return false
    }

    isDeploying.value = true
    isPaused.value = false
    abortController = new AbortController()

    if (!startTime.value) {
      startTime.value = new Date().toISOString()
      currentPlan.value.status = 'deploying'
      currentPlan.value.startedAt = startTime.value
    }

    addLog('info', 'Starting deployment...')

    // Execute steps sequentially
    for (const step of currentPlan.value.steps) {
      // Skip already completed steps (for resume)
      if (step.status === 'completed') continue

      // Check for pause/cancel
      if (isPaused.value) {
        addLog('info', 'Deployment paused')
        return true
      }

      if (abortController?.signal.aborted) {
        addLog('warning', 'Deployment cancelled')
        currentPlan.value.status = 'cancelled'
        isDeploying.value = false
        return false
      }

      // Execute the step
      const success = await executeStep(step)

      if (!success) {
        // Stop on failure
        currentPlan.value.status = 'failed'
        endTime.value = new Date().toISOString()
        currentPlan.value.completedAt = endTime.value
        isDeploying.value = false
        addLog('error', 'Deployment failed')
        return false
      }

      // Small delay between steps
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // All steps completed
    currentPlan.value.status = 'completed'
    endTime.value = new Date().toISOString()
    currentPlan.value.completedAt = endTime.value
    isDeploying.value = false
    addLog('success', 'Deployment completed successfully!')
    return true
  }

  /**
   * Pause deployment
   */
  function pauseDeployment() {
    if (isDeploying.value) {
      isPaused.value = true
      addLog('info', 'Pausing deployment...')
    }
  }

  /**
   * Cancel deployment
   */
  function cancelDeployment() {
    if (abortController) {
      abortController.abort()
    }
    isPaused.value = false
    isDeploying.value = false
    addLog('warning', 'Deployment cancelled by user')
  }

  /**
   * Reset deployment state
   */
  function resetDeployment() {
    if (currentPlan.value) {
      // Reset all step statuses
      currentPlan.value.steps.forEach(step => {
        step.status = 'pending'
        step.startedAt = undefined
        step.completedAt = undefined
        step.error = undefined
        step.progress = undefined
      })
      currentPlan.value.status = 'draft'
      currentPlan.value.startedAt = undefined
      currentPlan.value.completedAt = undefined
    }

    isDeploying.value = false
    isPaused.value = false
    startTime.value = null
    endTime.value = null
    clearLogs()
    addLog('info', 'Deployment reset')
  }

  /**
   * Clear current deployment
   */
  function clearDeployment() {
    currentPlan.value = null
    isDeploying.value = false
    isPaused.value = false
    startTime.value = null
    endTime.value = null
    clearLogs()
  }

  /**
   * Retry a failed step
   */
  async function retryStep(stepId: string): Promise<boolean> {
    if (!currentPlan.value) return false

    const step = currentPlan.value.steps.find(s => s.id === stepId)
    if (!step || step.status !== 'failed') {
      addLog('error', 'Cannot retry: step not found or not failed')
      return false
    }

    step.status = 'pending'
    step.error = undefined
    
    return executeStep(step)
  }

  /**
   * Skip a step
   */
  function skipStep(stepId: string) {
    if (!currentPlan.value) return

    const step = currentPlan.value.steps.find(s => s.id === stepId)
    if (step && (step.status === 'pending' || step.status === 'failed')) {
      step.status = 'skipped'
      addLog('warning', `Skipped: ${step.name}`, step.id)
    }
  }

  // =============================================================================
  // Return
  // =============================================================================

  return {
    // State
    currentPlan: computed(() => currentPlan.value),
    isDeploying: computed(() => isDeploying.value),
    isPaused: computed(() => isPaused.value),
    logs: computed(() => logs.value),
    startTime: computed(() => startTime.value),
    endTime: computed(() => endTime.value),

    // Computed
    progress,
    currentStep,
    completedSteps,
    failedSteps,
    pendingSteps,

    // Actions
    loadPlan,
    startDeployment,
    pauseDeployment,
    cancelDeployment,
    resetDeployment,
    clearDeployment,
    retryStep,
    skipStep,
    addLog,
    clearLogs,
  }
})

export default useDeploymentStore

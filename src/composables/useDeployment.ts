/**
 * Deployment Composable
 * 
 * Orchestrates the deployment workflow:
 * 1. Validate topology
 * 2. Generate deployment plan
 * 3. Load into deployment store
 * 4. Execute deployment
 */

import { ref, computed } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { useTopologyResolver } from './useTopologyResolver'
import { useDeploymentStore } from '@/stores/deploymentStore'
import { setBaseUrl } from '@/services/proxmox'

export function useDeployment() {
  const topologyResolver = useTopologyResolver()
  const deploymentStore = useDeploymentStore()

  // State
  const isValidating = ref(false)
  const isGeneratingPlan = ref(false)
  const showDeploymentPanel = ref(false)

  // Computed
  const validationErrors = computed(() => topologyResolver.errors.value)
  const validationWarnings = computed(() => topologyResolver.warnings.value)
  const hasValidationErrors = computed(() => validationErrors.value.length > 0)
  const currentPlan = computed(() => deploymentStore.currentPlan)
  const isDeploying = computed(() => deploymentStore.isDeploying)

  /**
   * Configure the API with Proxmox settings
   */
  function configureApi(baseUrl: string) {
    setBaseUrl(baseUrl)
  }

  /**
   * Validate the current topology
   */
  function validateTopology(nodes: Node[], edges: Edge[]) {
    isValidating.value = true
    try {
      const result = topologyResolver.validateTopology(nodes as any, edges)
      return result
    } finally {
      isValidating.value = false
    }
  }

  /**
   * Generate a deployment plan from the topology
   */
  function generatePlan(
    nodes: Node[],
    edges: Edge[],
    options: {
      proxmoxNode: string
      projectId?: string
      projectName?: string
      startVmId?: number
    }
  ) {
    isGeneratingPlan.value = true
    try {
      const plan = topologyResolver.resolve(nodes, edges, {
        proxmoxNode: options.proxmoxNode,
        startVmId: options.startVmId || 100,
      })

      // Update plan metadata
      plan.projectId = options.projectId || ''
      plan.name = options.projectName 
        ? `Deploy: ${options.projectName}` 
        : 'Deployment Plan'

      return plan
    } finally {
      isGeneratingPlan.value = false
    }
  }

  /**
   * Prepare deployment: validate, generate plan, load into store
   */
  function prepareDeployment(
    nodes: Node[],
    edges: Edge[],
    options: {
      proxmoxNode: string
      baseUrl: string
      projectId?: string
      projectName?: string
      startVmId?: number
    }
  ) {
    // Configure API
    configureApi(options.baseUrl)

    // Validate topology
    const validation = validateTopology(nodes, edges)
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
        plan: null,
      }
    }

    // Generate plan
    const plan = generatePlan(nodes, edges, {
      proxmoxNode: options.proxmoxNode,
      projectId: options.projectId,
      projectName: options.projectName,
      startVmId: options.startVmId,
    })

    // Load into store
    deploymentStore.loadPlan(plan)

    return {
      success: true,
      errors: [],
      warnings: validation.warnings,
      plan,
    }
  }

  /**
   * Open the deployment panel
   */
  function openDeploymentPanel() {
    showDeploymentPanel.value = true
  }

  /**
   * Close the deployment panel
   */
  function closeDeploymentPanel() {
    showDeploymentPanel.value = false
  }

  /**
   * Start the deployment
   */
  async function startDeployment() {
    return deploymentStore.startDeployment()
  }

  /**
   * Full deployment flow: prepare and open panel
   */
  function deploy(
    nodes: Node[],
    edges: Edge[],
    options: {
      proxmoxNode: string
      baseUrl: string
      projectId?: string
      projectName?: string
      startVmId?: number
    }
  ) {
    const result = prepareDeployment(nodes, edges, options)
    
    if (result.success) {
      openDeploymentPanel()
    }
    
    return result
  }

  return {
    // State
    isValidating,
    isGeneratingPlan,
    showDeploymentPanel,

    // Computed
    validationErrors,
    validationWarnings,
    hasValidationErrors,
    currentPlan,
    isDeploying,

    // Methods
    configureApi,
    validateTopology,
    generatePlan,
    prepareDeployment,
    openDeploymentPanel,
    closeDeploymentPanel,
    startDeployment,
    deploy,
  }
}

export default useDeployment

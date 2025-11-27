/**
 * Deployment Composable
 * 
 * Orchestrates the deployment workflow:
 * 1. Validate topology
 * 2. Generate deployment plan
 * 3. Load into deployment store
 * 4. Execute deployment
 * 
 * Integrates with useProxmoxSettings for project-specific configuration.
 */

import { ref, computed, type Ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { useTopologyResolver } from './useTopologyResolver'
import { useDeploymentStore } from '@/stores/deploymentStore'
import { setBaseUrl } from '@/services/proxmox'
import { useProxmoxSettingsStore } from './useProxmoxSettings'

export interface DeploymentOptions {
  proxmoxNode?: string
  backendApiUrl?: string
  projectId?: string
  projectName?: string
  startVmId?: number
}

export function useDeployment(projectIdRef?: Ref<string | null | undefined>) {
  const topologyResolver = useTopologyResolver()
  const deploymentStore = useDeploymentStore()
  const settingsStore = useProxmoxSettingsStore()

  // State
  const isValidating = ref(false)
  const isGeneratingPlan = ref(false)
  const showDeploymentPanel = ref(false)

  // Computed - get settings from store if projectId provided
  const projectSettings = computed(() => {
    const id = projectIdRef?.value
    return id ? settingsStore.getProjectSettings(id) : null
  })
  
  const isConfigured = computed(() => {
    const id = projectIdRef?.value
    return id ? settingsStore.hasValidSettings(id) : false
  })

  const validationErrors = computed(() => topologyResolver.errors.value)
  const validationWarnings = computed(() => topologyResolver.warnings.value)
  const hasValidationErrors = computed(() => validationErrors.value.length > 0)
  const currentPlan = computed(() => deploymentStore.currentPlan)
  const isDeploying = computed(() => deploymentStore.isDeploying)

  /**
   * Configure the API with backend API URL
   */
  function configureApi(backendApiUrl?: string) {
    const url = backendApiUrl || projectSettings.value?.backendApiUrl || projectSettings.value?.baseUrl
    if (url) {
      setBaseUrl(url)
      return true
    }
    return false
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
   * Can use explicit options or fall back to project settings
   */
  function prepareDeployment(
    nodes: Node[],
    edges: Edge[],
    options?: DeploymentOptions
  ) {
    // Get settings from options or project settings
    const backendApiUrl = options?.backendApiUrl || projectSettings.value?.backendApiUrl || projectSettings.value?.baseUrl
    const proxmoxNode = options?.proxmoxNode || projectSettings.value?.proxmoxNode || projectSettings.value?.defaultNode
    const projectId = options?.projectId || projectIdRef?.value
    
    // Validate we have required settings
    if (!backendApiUrl) {
      return {
        success: false,
        errors: [{ nodeId: '', field: 'settings', message: 'Backend API URL not configured. Please configure in project settings.' }],
        warnings: [],
        plan: null,
        needsConfiguration: true,
      }
    }
    
    if (!proxmoxNode) {
      return {
        success: false,
        errors: [{ nodeId: '', field: 'settings', message: 'Proxmox node not configured. Please configure in project settings.' }],
        warnings: [],
        plan: null,
        needsConfiguration: true,
      }
    }

    // Configure API
    configureApi(backendApiUrl)

    // Validate topology
    const validation = validateTopology(nodes, edges)
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
        plan: null,
        needsConfiguration: false,
      }
    }

    // Generate plan
    const plan = generatePlan(nodes, edges, {
      proxmoxNode,
      projectId: projectId || undefined,
      projectName: options?.projectName,
      startVmId: options?.startVmId,
    })

    // Load into store
    deploymentStore.loadPlan(plan)

    return {
      success: true,
      errors: [],
      warnings: validation.warnings,
      plan,
      needsConfiguration: false,
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
   * Uses project settings automatically if projectIdRef was provided
   */
  function deploy(
    nodes: Node[],
    edges: Edge[],
    options?: DeploymentOptions
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

    // Computed - settings awareness
    projectSettings,
    isConfigured,
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

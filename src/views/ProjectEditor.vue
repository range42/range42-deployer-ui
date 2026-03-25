<script setup>
import { ref, onMounted, watch, computed, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'

import Sidebar from '../components/Sidebar.vue'

// Node components for deployable Proxmox resources
import InfraNodeVm from '../components/nodes/InfraNodeVm.vue'
import InfraNodeLxc from '../components/nodes/InfraNodeLxc.vue'
import InfraNodeNetwork from '../components/nodes/InfraNodeNetwork.vue'
import InfraNodeRouter from '../components/nodes/InfraNodeRouter.vue'
import InfraNodeEdgeFirewall from '../components/nodes/InfraNodeEdgeFirewall.vue'
import InfraNodeGroup from '../components/nodes/InfraNodeGroup.vue'
import NetworkEdge from '../components/edges/NetworkEdge.vue'
import ConfigPanel from '../components/ConfigPanel.vue'
import EdgeConfigPanel from '../components/EdgeConfigPanel.vue'
import ExportModal from '../components/ExportModal.vue'
import ProxmoxSettingsModal from '../components/ProxmoxSettingsModal.vue'
import DeploymentPanel from '../components/DeploymentPanel.vue'
import DeployReconcileModal from '../components/DeployReconcileModal.vue'
import InfrastructureImportModal from '../components/InfrastructureImportModal.vue'

import { useInfraBuilder } from '../composables/useInfraBuilder'
import { useDeployment } from '../composables/useDeployment'
import { useApiConfig } from '../composables/useApiConfig'
import { useWebSocketStatus } from '../composables/useWebSocketStatus'
// setBaseUrl is managed via useApiConfig composable
import { useDragAndDrop } from '../composables/useDragAndDrop'
import { useProjectStore } from '../stores/projectStore'


////

import { useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume } from '@/composables/runnerCalls/bundle/core/proxmox/configure/DefaultVms/startStopPauseResumeVms'
import { useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms } from '@/composables/runnerCalls/bundle/core/proxmox/configure/DefaultVms/delete'

import { useBundleCoreProxmoxConfigureDefaultVms_createTargetVms } from '@/composables/runnerCalls/bundle/core/proxmox/configure/DefaultVms/create'


import { useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms } from '@/composables/runnerCalls/bundle/core/proxmox/configure/DefaultVms/snapshots/revert'
import { useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms } from '@/composables/runnerCalls/bundle/core/proxmox/configure/DefaultVms/snapshots/create'

////

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

const {
  nodes,
  edges,
  selectedNode,
  selectedEdge,
  onConnect,
  onNodeClick,
  onEdgeClick,
  updateNodeStatus,
  updateEdgeData,
  closeEdgeConfig,
  onNodesChange,
  onEdgesChange,
  loadProjectData
} = useInfraBuilder()

const { getNodes: flowGetNodes, getEdges: flowGetEdges, addNodes: vfAddNodes, addEdges: vfAddEdges } = useVueFlow()

const dragAndDropComposable = useDragAndDrop()
const { onDragOver, onDrop, onDragLeave, isDragOver } = dragAndDropComposable || {}

const showConfigPanel = ref(false)
const showExportModal = ref(false)
const showProxmoxSettings = ref(false)
const showDeploymentPanel = ref(false)
const showInventoryBrowser = ref(false)
const showTemplateBrowser = ref(false)
const showImportModal = ref(false)
const showDeleteProjectModal = ref(false)
const deleteConfirmName = ref('')
const validationErrors = ref([])
const currentProject = ref(null)

// Project ID as computed ref for composables
const projectId = computed(() => currentProject.value?.id || route.params.id)

// Deployment composable - now auto-uses project settings
const deployment = useDeployment(projectId)

const liveNodes = computed(() => (flowGetNodes?.value && flowGetNodes.value.length ? flowGetNodes.value : nodes.value) || [])
const liveEdges = computed(() => (flowGetEdges?.value && flowGetEdges.value.length ? flowGetEdges.value : edges.value) || [])

// WebSocket live status — updates deployed nodes in real-time
const wsStatus = useWebSocketStatus()

// Sync WebSocket status changes to canvas nodes
watch(() => wsStatus.vmStatuses.value, (statuses) => {
  if (!statuses || statuses.size === 0) return
  const allNodes = flowGetNodes?.value || nodes.value || []
  for (const node of allNodes) {
    const vmId = Number(node.data?.vmId)
    if (!vmId || !statuses.has(vmId)) continue

    const vm = statuses.get(vmId)
    const newStatus = vm.status === 'running' ? 'running' : vm.status === 'paused' ? 'paused' : 'stopped'
    if (node.data.status !== newStatus) {
      node.data.status = newStatus
    }

    // Sync live metrics
    if (vm.status === 'running') {
      node.data.liveMetrics = {
        cpu: vm.cpu,
        mem: vm.mem,
        maxmem: vm.maxmem,
        memPercent: vm.maxmem > 0 ? Math.round((vm.mem / vm.maxmem) * 100) : 0,
        uptime: vm.uptime,
      }
    } else {
      node.data.liveMetrics = null
    }

    // Sync tags from WebSocket (semicolon-separated)
    if (vm.tags) {
      const wsTags = vm.tags.split(';').filter(Boolean)
      const currentTags = node.data.tags || []
      if (JSON.stringify(wsTags) !== JSON.stringify(currentTags)) {
        node.data.tags = wsTags
      }
    }
  }
}, { deep: true })

////

// Bundle composables — only destructure loading/error for global state
// Individual handlers will be destructured when the action panel UI is built
const {
  loading: loading_startStopPauseResumeDefaultVms,
  error: error_startStopPauseResumeDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume(computed(() => currentProject.value?.id))

const {
  loading: loading_deleteDefaultVms,
  error: error_deleteDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms(computed(() => currentProject.value?.id))

const {
  loading: createVms_loading,
  error: error_createDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVms_createTargetVms(computed(() => currentProject.value?.id))

const {
  loading: loading_snapshotRevertDefaultVms,
  error: error_snapshotRevertDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(computed(() => currentProject.value?.id))

const {
  loading: loading_snapshotCreateDefaultVms,
  error: error_snapshotCreateDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms(computed(() => currentProject.value?.id))

////

const _loading = computed(() => {
  return loading_startStopPauseResumeDefaultVms.value ||
    loading_deleteDefaultVms.value ||
    createVms_loading.value ||
    loading_snapshotRevertDefaultVms.value ||
    loading_snapshotCreateDefaultVms.value
})

const error = computed(() => {
  return error_startStopPauseResumeDefaultVms.value ||
    error_deleteDefaultVms.value ||
    error_createDefaultVms.value ||
    error_snapshotRevertDefaultVms.value ||
    error_snapshotCreateDefaultVms.value
})

////

onMounted(() => {
  const project = projectStore.getProject(route.params.id)
  if (!project) {
    router.push('/')
    return
  }

  currentProject.value = project
  loadProjectData(project)

})

// Reactively connect WebSocket when API settings become ready
watch(
  () => importApiConfig.isReady.value,
  (ready) => {
    if (ready) {
      importApiConfig.configure()
      wsStatus.connect(importApiConfig.node.value || 'pve01')
    } else {
      wsStatus.disconnect()
    }
  },
  { immediate: true }
)

watch([nodes, edges], () => {
  if (currentProject.value) {
    projectStore.updateProject(currentProject.value.id, {
      nodes: nodes.value,
      edges: edges.value
    })
  }
}, { deep: true })

const manualSave = () => {
  if (!currentProject.value) return
  const nodesToSave = liveNodes.value
  const edgesToSave = liveEdges.value
  projectStore.updateProject(currentProject.value.id, {
    nodes: nodesToSave,
    edges: edgesToSave
  })
}

const handleNodeClick = (event) => {
  onNodeClick(event)
  showConfigPanel.value = !!selectedNode.value
}

const closeConfigPanel = () => {
  showConfigPanel.value = false
  selectedNode.value = null
}

// Edge handlers for network connection configuration
const handleEdgeClick = (event) => {
  onEdgeClick(event)
  showConfigPanel.value = false // Close node config when edge is selected
}

const showEdgeConfig = computed(() => !!selectedEdge.value?.data)

// Get source and target nodes for the selected edge
const edgeSourceNode = computed(() => {
  if (!selectedEdge.value) return null
  const allNodes = flowGetNodes.value || nodes.value
  return allNodes.find(n => n.id === selectedEdge.value.source)
})

const edgeTargetNode = computed(() => {
  if (!selectedEdge.value) return null
  const allNodes = flowGetNodes.value || nodes.value
  return allNodes.find(n => n.id === selectedEdge.value.target)
})

const handleEdgeUpdate = (edgeId, updates) => {
  updateEdgeData(edgeId, updates)
}

const handleCloseEdgeConfig = () => {
  closeEdgeConfig()
}

const handleDeleteNode = (nodeId) => {
  // Remove from controlled nodes ref (VueFlow controlled mode)
  nodes.value = nodes.value.filter(n => n.id !== nodeId)
  // Also remove any edges connected to this node
  edges.value = edges.value.filter(e => e.source !== nodeId && e.target !== nodeId)
  closeConfigPanel()
}

const goBack = () => {
  router.push('/')
}

const handleDrop = (event) => {
  onDrop(event)
}

const handleDragOver = (event) => {
  event.preventDefault()
  onDragOver(event)
}

const handleDragLeave = (event) => {
  onDragLeave(event)
}

const openProxmoxSettings = () => {
  showProxmoxSettings.value = true
}

const closeProxmoxSettings = () => {
  showProxmoxSettings.value = false
}

// Deployment handlers
const showReconcileModal = ref(false)

const handleOpenDeploy = () => {
  // Ensure API is configured
  importApiConfig.configure()
  if (!importApiConfig.isReady.value) {
    alert('Please configure Backend API settings first (click Settings → Proxmox Settings)')
    showProxmoxSettings.value = true
    return
  }

  // Show reconciliation modal before deploying
  showReconcileModal.value = true
}

const handleReconcileProceed = (toDelete, toImport) => {
  showReconcileModal.value = false

  // Import kept VMs to canvas
  if (toImport && toImport.length > 0) {
    const importNodes = toImport.map((vm, i) => ({
      id: `imported-vm-${vm.vmid}`,
      type: 'vm',
      position: { x: 600, y: 100 + i * 120 },
      data: {
        type: 'vm',
        label: vm.name,
        vmId: vm.vmid,
        deployed: true,
        status: vm.status === 'running' ? 'running' : 'stopped',
        config: {
          name: vm.name,
          vmid: vm.vmid,
          cores: vm.maxcpu || 1,
          memory: String(vm.maxmem ? Math.floor(vm.maxmem / 1024 / 1024) : 0),
        },
      },
    }))
    vfAddNodes(JSON.parse(JSON.stringify(importNodes)))
  }

  // TODO: Add delete steps for toDelete VMs to the deployment plan

  // defaultStorage is a global preference, not per-project connection config
  const storedSettings = JSON.parse(localStorage.getItem('range42_proxmox_settings') || '{}')
  const defaultStorage = storedSettings.defaultStorage || 'local-zfs'

  // Now prepare and run deployment
  const result = deployment.deploy(
    liveNodes.value,
    liveEdges.value,
    {
      projectName: currentProject.value?.name,
      startVmId: 2000,
      defaultStorage,
    }
  )

  if (result.needsConfiguration) {
    alert('Please configure Backend API settings first (click Settings → Proxmox Settings)')
    showProxmoxSettings.value = true
    return
  }

  if (!result.success) {
    validationErrors.value = result.errors
    alert(`Validation failed:\n${result.errors.map(e => `- ${e.message}`).join('\n')}`)
    return
  }

  showDeploymentPanel.value = true
}

const handleOpenValidate = () => {
  const result = deployment.validateTopology(liveNodes.value, liveEdges.value)
  
  if (result.valid) {
    alert('Topology is valid! No errors found.')
  } else {
    const errorList = result.errors.map(e => `[Error] ${e.message}`).join('\n')
    const warningList = result.warnings.map(w => `[Warning] ${w.message}`).join('\n')
    alert(`Validation Results:\n\n${errorList}\n\n${warningList || 'No warnings'}`)
  }
}

const closeDeploymentPanel = () => {
  showDeploymentPanel.value = false
}

const confirmDeleteProject = () => {
  if (deleteConfirmName.value === currentProject.value?.name) {
    projectStore.deleteProject(currentProject.value.id)
    showDeleteProjectModal.value = false
    deleteConfirmName.value = ''
    router.push('/')
  }
}

// Import config: resolved from per-project settings at setup level
const importApiConfig = useApiConfig(projectId, { autoSync: true })

// Provide API config to child components (ConfigPanel, etc.)
provide('apiConfig', importApiConfig)

const handleOpenImport = () => {
  // Ensure the API client has the correct base URL from per-project settings
  importApiConfig.configure()
  showImportModal.value = true
}

const handleInfrastructureImport = (result) => {
  if (result.nodes && result.nodes.length > 0) {
    vfAddNodes(JSON.parse(JSON.stringify(result.nodes)))
  }
  if (result.edges && result.edges.length > 0) {
    vfAddEdges(JSON.parse(JSON.stringify(result.edges)))
  }
  showImportModal.value = false
}
</script>

<template>
  <div class="h-screen bg-base-100 flex" v-if="currentProject">
    <!-- Sidebar -->
    <Sidebar 
      :project="currentProject" 
      @openExport="showExportModal = true"
      @openDeploy="handleOpenDeploy"
      @openValidate="handleOpenValidate"
      @openInventory="showInventoryBrowser = true"
      @openTemplates="showTemplateBrowser = true"
      @openImport="handleOpenImport"
      class="hidden lg:flex shrink-0"
    />

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Top Bar -->
      <header class="h-14 px-4 flex items-center justify-between border-b border-base-300 bg-base-100 shrink-0">
        <div class="flex items-center gap-3">
          <!-- Mobile menu toggle -->
          <label for="mobile-drawer" class="btn btn-ghost btn-sm btn-square lg:hidden">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </label>
          
          <!-- Back button -->
          <button class="btn btn-ghost btn-sm gap-2" @click="goBack">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
            </svg>
            <span class="hidden sm:inline">Dashboard</span>
          </button>
          
          <div class="hidden sm:block h-6 w-px bg-base-300"></div>
          
          <!-- Project name -->
          <h1 class="font-semibold truncate max-w-[200px]">{{ currentProject.name }}</h1>
        </div>

        <!-- Right actions -->
        <div class="flex items-center gap-2">
          <!-- Save button -->
          <button class="btn btn-ghost btn-sm gap-2" @click="manualSave" title="Save (Ctrl+S)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
            </svg>
            <span class="hidden sm:inline">Save</span>
          </button>
          
          <!-- Settings dropdown -->
          <div class="dropdown dropdown-end">
            <label tabindex="0" class="btn btn-ghost btn-sm btn-square">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </label>
            <ul class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-xl w-56 border border-base-300">
              <li>
                <button class="gap-3" @click="openProxmoxSettings">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"></path>
                  </svg>
                  Proxmox Settings
                </button>
              </li>
              <li>
                <button class="gap-3" @click="handleOpenValidate">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  Validate Topology
                </button>
              </li>
              <div class="divider my-1"></div>
              <li>
                <button class="gap-3" @click="showExportModal = true">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  Export
                </button>
              </li>
              <div class="divider my-1"></div>
              <li>
                <button class="gap-3 text-error" @click="showDeleteProjectModal = true">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                  </svg>
                  Delete Project
                </button>
              </li>
            </ul>
          </div>
        </div>
      </header>


      <!-- VueFlow Canvas -->
      <div 
        class="flex-1 relative transition-colors duration-200" 
        :class="{ 'bg-primary/5 ring-2 ring-primary/20 ring-inset': isDragOver }"
        @drop="handleDrop" 
        @dragover="handleDragOver" 
        @dragleave="handleDragLeave"
      >
        <VueFlow 
          :nodes="nodes" 
          :edges="edges" 
          @connect="onConnect" 
          @node-click="handleNodeClick"
          @edge-click="handleEdgeClick" 
          @nodes-change="onNodesChange" 
          @edges-change="onEdgesChange" 
          fit-view-on-init 
          elevate-edges-on-select 
          class="h-full w-full"
        >
          <Background />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" />

          <!-- Organization -->
          <template #node-group="props">
            <InfraNodeGroup v-bind="props" />
          </template>

          <!-- Compute -->
          <template #node-vm="props">
            <InfraNodeVm v-bind="props" />
          </template>

          <template #node-lxc="props">
            <InfraNodeLxc v-bind="props" />
          </template>

          <!-- Network -->
          <template #node-network-segment="props">
            <InfraNodeNetwork v-bind="props" />
          </template>

          <template #node-edge-firewall="props">
            <InfraNodeEdgeFirewall v-bind="props" />
          </template>

          <template #node-router="props">
            <InfraNodeRouter v-bind="props" />
          </template>

          <!-- Custom Edge for network connections -->
          <template #edge-network="props">
            <NetworkEdge v-bind="props" />
          </template>
        </VueFlow>

        <!-- Drop Indicator -->
        <div v-if="isDragOver" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div class="bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/30 rounded-2xl p-6 text-center">
            <div class="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mx-auto mb-3">
              <svg class="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
              </svg>
            </div>
            <p class="font-medium text-primary">Drop to add component</p>
          </div>
        </div>

        <!-- Error Toast -->
        <div v-if="error" class="absolute top-4 right-4 z-20">
          <div class="alert alert-error shadow-lg max-w-sm">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span class="text-sm">{{ error }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Config Panel -->
    <ConfigPanel
      v-if="selectedNode && showConfigPanel"
      :node="selectedNode"
      @close="closeConfigPanel"
      @update="updateNodeStatus"
      @delete="handleDeleteNode"
    />
    
    <!-- Edge Config Panel -->
    <div v-if="showEdgeConfig" class="fixed right-4 top-20 z-50">
      <EdgeConfigPanel 
        :edge="selectedEdge" 
        :source-node="edgeSourceNode"
        :target-node="edgeTargetNode"
        @close="handleCloseEdgeConfig"
        @update="handleEdgeUpdate"
      />
    </div>
    
    <!-- Modals -->
    <ExportModal 
      :project="currentProject" 
      :visible="showExportModal" 
      :nodes="liveNodes" 
      :edges="liveEdges"
      @close="showExportModal = false" 
    />
    
    <ProxmoxSettingsModal
      v-if="currentProject"
      :visible="showProxmoxSettings"
      :project-id="currentProject.id"
      @close="closeProxmoxSettings"
      @saved="closeProxmoxSettings"
    />
    
    <DeploymentPanel
      v-if="showDeploymentPanel"
      @close="closeDeploymentPanel"
    />

    <!-- Delete Project Confirmation Modal -->
    <div v-if="showDeleteProjectModal" class="modal modal-open">
      <div class="modal-box max-w-md">
        <h3 class="text-lg font-bold text-error flex items-center gap-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
          Delete Project
        </h3>
        <p class="py-4 text-base-content/70">
          This action cannot be undone. To confirm, type the project name:
        </p>
        <p class="font-mono text-sm bg-base-200 px-3 py-2 rounded mb-4">{{ currentProject?.name }}</p>
        <input
          v-model="deleteConfirmName"
          type="text"
          class="input input-bordered w-full"
          placeholder="Type project name to confirm"
          @keyup.enter="confirmDeleteProject"
        />
        <div class="modal-action">
          <button class="btn btn-ghost" @click="showDeleteProjectModal = false; deleteConfirmName = ''">
            Cancel
          </button>
          <button
            class="btn btn-error"
            :disabled="deleteConfirmName !== currentProject?.name"
            @click="confirmDeleteProject"
          >
            Delete Forever
          </button>
        </div>
      </div>
      <div class="modal-backdrop bg-base-300/80" @click="showDeleteProjectModal = false"></div>
    </div>
  </div>

  <!-- Loading state -->
  <div v-else class="h-screen flex items-center justify-center bg-base-100">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>

  <!-- Import modal — teleported to body so it's not constrained by the flex layout -->
  <Teleport to="body">
    <InfrastructureImportModal
      v-if="showImportModal"
      :api-url="importApiConfig.apiUrl.value"
      :proxmox-node="importApiConfig.node.value"
      @close="showImportModal = false"
      @import="handleInfrastructureImport"
    />

    <DeployReconcileModal
      v-if="showReconcileModal"
      :canvas-vm-ids="new Set((liveNodes || []).filter(n => n.data?.vmId).map(n => n.data.vmId))"
      :proxmox-node="importApiConfig.node.value || 'pve01'"
      @proceed="handleReconcileProceed"
      @cancel="showReconcileModal = false"
    />
  </Teleport>
</template>

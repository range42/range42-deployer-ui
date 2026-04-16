<script setup>
import { ref, onMounted, onUnmounted, watch, computed, provide } from 'vue'
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
import GroupNode from '../components/nodes/GroupNode.vue'
import DockerNode from '../components/nodes/DockerNode.vue'
import NetworkEdge from '../components/edges/NetworkEdge.vue'
import DockerTetherEdge from '../components/edges/DockerTetherEdge.vue'
import ConfigPanel from '../components/ConfigPanel.vue'
import EdgeConfigPanel from '../components/EdgeConfigPanel.vue'
import ExportModal from '../components/ExportModal.vue'
import ProxmoxSettingsModal from '../components/ProxmoxSettingsModal.vue'
import DeploymentPanel from '../components/DeploymentPanel.vue'
import DeployReconcileModal from '../components/DeployReconcileModal.vue'
import InfrastructureImportModal from '../components/InfrastructureImportModal.vue'
import TemplateBrowser from '../components/TemplateBrowser.vue'
import ProblemsPanel from '../components/project/ProblemsPanel.vue'
import CommandPalette from '../components/project/CommandPalette.vue'
import ConfigTab from '../components/project/ConfigTab.vue'
import HistoryTab from '../components/project/HistoryTab.vue'
import VariablesTab from '../components/project/VariablesTab.vue'
import DeployForm from '../components/project/DeployForm.vue'
import { createMemoryFs } from '../services/projectRepo/memoryFs'
import { ensureNamespaces } from '../i18n'
import { useCanvasHistory } from '../composables/useCanvasHistory'
import { getProvider as getV1Provider, getGitProvider } from '../services/git'
import { useProblems } from '../composables/useProblems'
import { useHotkeys } from '../composables/useHotkeys'

import { useAutoLayout } from '../composables/useAutoLayout'
import { useNetworkZones } from '../composables/useNetworkZones'
import { useCanvasLiveStatus } from '../composables/useCanvasLiveStatus'
import { useDeploymentStore } from '../stores/deploymentStore.ts'
import NetworkZoneOverlay from '../components/NetworkZoneOverlay.vue'
import { useInfraBuilder, computeDockerTetherEdges } from '../composables/useInfraBuilder'
import { useDeployment } from '../composables/useDeployment'
import { useApiConfig } from '../composables/useApiConfig'
import { useWebSocketStatus } from '../composables/useWebSocketStatus'
// setBaseUrl is managed via useApiConfig composable
import { useDragAndDrop } from '../composables/useDragAndDrop'
import { useToast } from '../composables/useToast'
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

const { getNodes: flowGetNodes, getEdges: flowGetEdges, addNodes: vfAddNodes, addEdges: vfAddEdges, updateNodeData } = useVueFlow()

const { showToast } = useToast()
const dragAndDropComposable = useDragAndDrop()
const { onDragOver, onDrop, onDragLeave, isDragOver } = dragAndDropComposable || {}

const showConfigPanel = ref(false)
const showExportModal = ref(false)
const showProxmoxSettings = ref(false)
const showDeploymentPanel = ref(false)
// Plan C §C4.6 — new-style DeployForm with inline preflight + SHA-pin.
const showDeployForm = ref(false)
const existingCodenames = ref([])
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

// Docker containment tethers are derived from docker.data.host_ref — they are
// rendered alongside user-authored edges but never persisted.
const dockerTetherEdges = computed(() => computeDockerTetherEdges(liveNodes.value))
const renderedEdges = computed(() => [...(edges.value || []), ...dockerTetherEdges.value])

// Problems panel — reactive over the live canvas graph.
const attachmentsRef = computed(() => currentProject.value?.attachments || [])
const { problems: problemList } = useProblems(liveNodes, liveEdges, attachmentsRef)
const showProblemsPanel = ref(true)

// Command palette (Ctrl/Cmd-P).
const showCommandPalette = ref(false)
const paletteItems = computed(() => {
  const items = []
  for (const n of liveNodes.value || []) {
    items.push({
      id: `node:${n.id}`,
      kind: 'node',
      label: n.data?.config?.name || n.data?.label || n.id,
      subtitle: `${n.type} · ${n.id}`,
      jumpTo: { kind: 'node', id: n.id },
    })
  }
  for (const a of attachmentsRef.value || []) {
    items.push({
      id: `attachment:${a.id}`,
      kind: 'attachment',
      label: a.name || a.id,
      subtitle: a.file_path || a.path || '',
      jumpTo: { kind: 'attachment', id: a.id },
    })
  }
  for (const f of (currentProject.value?.files || [])) {
    items.push({
      id: `file:${f.path}`,
      kind: 'file',
      label: (f.path || '').split('/').pop() || f.path,
      subtitle: f.path,
      jumpTo: { kind: 'file', id: f.path },
    })
  }
  return items
})

useHotkeys([
  {
    key: 'p',
    when: () => true,
    handler: (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      showCommandPalette.value = !showCommandPalette.value
    },
  },
])

function handleJumpTo(descriptor) {
  if (!descriptor) return
  if (descriptor.kind === 'node') {
    const n = (liveNodes.value || []).find((x) => x.id === descriptor.id)
    if (n) {
      selectedNode.value = n
      showConfigPanel.value = true
    }
  } else if (descriptor.kind === 'edge') {
    const e = (liveEdges.value || []).find((x) => x.id === descriptor.id)
    if (e) selectedEdge.value = e
  }
  // attachment / file jumps will be wired when the Config tab lands (C3.7).
}

const { zones } = useNetworkZones(liveNodes, liveEdges)

const autoLayout = useAutoLayout()

// Plan C §C4.7 — Canvas live status from SSE stream.
// Finds the active (non-terminal) deployment for this project, subscribes
// to its SSE stream, and mirrors per-node status into VueFlow node data.
const deploymentStore = useDeploymentStore()
const activeDeploymentId = ref(null)
const TERMINAL_STATES_CANVAS = new Set(['deployed', 'failed', 'cancelled', 'torn_down'])

async function refreshActiveDeployment() {
  const pid = projectId.value
  if (!pid) return
  try {
    const res = await fetch('/v1/deployments', { credentials: 'same-origin' })
    if (!res.ok) return
    const body = await res.json()
    const items = Array.isArray(body) ? body : (body?.deployments || [])
    const active = items.find(d => d.project_id === pid && !TERMINAL_STATES_CANVAS.has(d.state))
    if (active?.id !== activeDeploymentId.value) {
      if (activeDeploymentId.value) deploymentStore.unsubscribe(activeDeploymentId.value)
      activeDeploymentId.value = active?.id || null
      if (activeDeploymentId.value) deploymentStore.subscribe(activeDeploymentId.value)
    }
  } catch {
    // Backend unavailable — silently skip; canvas falls back to WS status.
  }
}

const liveRecord = computed(() => {
  const id = activeDeploymentId.value
  if (!id) return null
  return deploymentStore.deployments[id] || null
})

// Resolve an event ident to a canvas node id.
// Order: explicit node_id match > host match > vmId numeric match.
function resolveCanvasNodeId(ident) {
  const all = flowGetNodes?.value || nodes.value || []
  if (ident?.node_id) {
    const byId = all.find(n => n.id === ident.node_id)
    if (byId) return byId.id
    const byCfgName = all.find(n => n.data?.config?.name === ident.node_id)
    if (byCfgName) return byCfgName.id
  }
  if (ident?.host) {
    const byHost = all.find(n => n.data?.config?.name === ident.host || n.data?.label === ident.host)
    if (byHost) return byHost.id
  }
  if (ident?.vm_id != null) {
    const vmIdNum = Number(ident.vm_id)
    const byVmId = all.find(n => Number(n.data?.vmId) === vmIdNum || Number(n.data?.config?.vmid) === vmIdNum)
    if (byVmId) return byVmId.id
  }
  return null
}

const { statuses: canvasLiveStatuses } = useCanvasLiveStatus(liveRecord, resolveCanvasNodeId)

// Translate the status palette used by the canvas composable to VueFlow node
// data.status used by infrastructure node components (keeps parity with the
// existing gray/orange/green/red/blue palette).
const CANVAS_COLOR_TO_NODE_STATUS = {
  gray: 'pending',
  blue: 'deploying',
  green: 'running',
  red: 'error',
  orange: 'warn',
}

watch(canvasLiveStatuses, (map) => {
  if (!map || map.size === 0) return
  const all = flowGetNodes?.value || nodes.value || []
  for (const node of all) {
    const colour = map.get(node.id)
    if (!colour) continue
    const next = CANVAS_COLOR_TO_NODE_STATUS[colour]
    if (!next) continue
    if (node.data?.status !== next) {
      updateNodeData(node.id, { status: next })
    }
  }
}, { deep: true })

// WebSocket live status — updates deployed nodes in real-time
const wsStatus = useWebSocketStatus()

// Sync WebSocket status changes to canvas nodes via VueFlow's updateNodeData
watch(() => wsStatus.vmStatuses.value, (statuses) => {
  if (!statuses || statuses.size === 0) return
  const allNodes = flowGetNodes?.value || nodes.value || []

  for (const node of allNodes) {
    const vmId = Number(node.data?.vmId)
    if (!vmId || !statuses.has(vmId)) continue

    const vm = statuses.get(vmId)
    const newStatus = vm.status === 'running' ? 'running' : vm.status === 'paused' ? 'paused' : 'stopped'

    const dataUpdate = {}
    let needsUpdate = false

    if (node.data.status !== newStatus) {
      dataUpdate.status = newStatus
      needsUpdate = true
    }

    // Sync live metrics
    if (vm.status === 'running') {
      dataUpdate.liveMetrics = {
        cpu: vm.cpu,
        mem: vm.mem,
        maxmem: vm.maxmem,
        memPercent: vm.maxmem > 0 ? Math.round((vm.mem / vm.maxmem) * 100) : 0,
        uptime: vm.uptime,
      }
      needsUpdate = true
    } else if (node.data.liveMetrics) {
      dataUpdate.liveMetrics = null
      needsUpdate = true
    }

    // Sync tags from WebSocket (semicolon-separated)
    if (vm.tags) {
      const wsTags = vm.tags.split(';').filter(Boolean)
      const currentTags = node.data.tags || []
      if (JSON.stringify(wsTags) !== JSON.stringify(currentTags)) {
        dataUpdate.tags = wsTags
        needsUpdate = true
      }
    }

    if (needsUpdate) {
      updateNodeData(node.id, dataUpdate)
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
  ensureNamespaces(['configTab', 'historyTab', 'variablesTab', 'common'])
  // Plan C §C4.7 — attach live SSE to canvas when an active deployment exists.
  refreshActiveDeployment()
})

onUnmounted(() => {
  if (activeDeploymentId.value) {
    deploymentStore.unsubscribe(activeDeploymentId.value)
    activeDeploymentId.value = null
  }
})

// Canvas undo ring-buffer (C3.11). We snapshot on every node/edge mutation
// so Ctrl-Z / Ctrl-Shift-Z can walk back through the history. Snapshots
// are deep-cloned so future mutations don't retroactively alter old
// entries.
const canvasHistory = useCanvasHistory()
function cloneSnapshot() {
  return JSON.parse(JSON.stringify({
    nodes: nodes.value || [],
    edges: edges.value || [],
  }))
}

// Debounced autosave (C3.11). 500ms debounce avoids flooding localStorage
// on every canvas nudge. When the project is wired to a git-backed
// ProjectRepoAdapter, the autosave body will also call adapter.autosave.
let autosaveTimer = null
function scheduleAutosave() {
  if (!currentProject.value) return
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    if (!currentProject.value) return
    projectStore.updateProject(currentProject.value.id, {
      nodes: nodes.value,
      edges: edges.value,
    })
  }, 500)
}

watch([nodes, edges], () => {
  if (!currentProject.value) return
  canvasHistory.push(cloneSnapshot())
  scheduleAutosave()
}, { deep: true })

// Undo / redo hotkeys — only fired while the canvas tab is active so we
// don't hijack CodeMirror's built-in undo on the Config tab.
useHotkeys([
  {
    key: 'z',
    when: () => tab.value === 'canvas',
    handler: (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.shiftKey) {
        const next = canvasHistory.redo()
        if (next) applyCanvasSnapshot(next)
      } else {
        const next = canvasHistory.undo()
        if (next) applyCanvasSnapshot(next)
      }
    },
  },
])

function applyCanvasSnapshot(snapshot) {
  // Applying a snapshot writes back via loadProjectData so selection +
  // VueFlow state stay in sync with the restored graph.
  loadProjectData({
    ...currentProject.value,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
  })
}

onUnmounted(() => {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
})

const manualSave = () => {
  if (!currentProject.value) return
  const nodesToSave = liveNodes.value
  const edgesToSave = liveEdges.value
  projectStore.updateProject(currentProject.value.id, {
    nodes: nodesToSave,
    edges: edgesToSave
  })
}

let layoutAnimationId = null

function handleAutoLayout() {
  // Cancel any in-flight animation before starting a new one
  if (layoutAnimationId !== null) {
    cancelAnimationFrame(layoutAnimationId)
    layoutAnimationId = null
  }

  const currentNodes = liveNodes.value
  const currentEdges = liveEdges.value
  if (currentNodes.length === 0) return

  const newPositions = autoLayout.applyLayout(currentNodes, currentEdges)

  // Animate nodes to new positions over 300ms
  const duration = 300
  const startTime = performance.now()
  const startPositions = new Map(currentNodes.map(n => [n.id, { x: n.position.x, y: n.position.y }]))

  function animate(now) {
    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    const ease = 1 - Math.pow(1 - t, 3)

    for (const node of currentNodes) {
      const start = startPositions.get(node.id)
      const target = newPositions.get(node.id)
      if (start && target) {
        node.position = {
          x: start.x + (target.x - start.x) * ease,
          y: start.y + (target.y - start.y) * ease,
        }
      }
    }

    if (t < 1) {
      layoutAnimationId = requestAnimationFrame(animate)
    } else {
      layoutAnimationId = null
    }
  }

  layoutAnimationId = requestAnimationFrame(animate)
}

onUnmounted(() => {
  if (layoutAnimationId !== null) {
    cancelAnimationFrame(layoutAnimationId)
    layoutAnimationId = null
  }
})

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

const handleOpenDeploy = async () => {
  // Fetch known codenames from the backend deployments index so the
  // DeployForm can flag local collisions client-instant.
  try {
    const res = await fetch('/v1/deployments', { credentials: 'same-origin' })
    if (res.ok) {
      const body = await res.json()
      const items = Array.isArray(body) ? body : (body?.deployments || [])
      existingCodenames.value = items.map(d => d.codename).filter(Boolean)
    }
  } catch {
    existingCodenames.value = []
  }
  showDeployForm.value = true
}

// Legacy canvas-reconcile path preserved for imported Proxmox VMs.
// Kept for future re-wiring alongside the new DeployForm when canvas drift
// detection lands (§C3.x). Prefixed with _ to satisfy linter until re-used.
const _handleOpenLegacyDeploy = () => {
  importApiConfig.configure()
  if (!importApiConfig.isReady.value) {
    showToast('Please configure Backend API settings first', 'warning')
    showProxmoxSettings.value = true
    return
  }
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

  // Warn about VMs marked for deletion (not yet automated)
  if (toDelete && toDelete.length > 0) {
    const vmNames = toDelete.map(vm => `${vm.name} (${vm.vmid})`).join(', ')
    showToast(`${toDelete.length} VM(s) marked for deletion must be removed manually: ${vmNames}`, 'warning', 8000)
  }

  // Global preferences (not per-project connection config)
  const storedSettings = JSON.parse(localStorage.getItem('range42_proxmox_settings') || '{}')
  const defaultStorage = storedSettings.defaultStorage || 'local-zfs'
  const startVmId = parseInt(storedSettings.startVmId, 10) || 2000

  // Now prepare and run deployment
  const result = deployment.deploy(
    liveNodes.value,
    liveEdges.value,
    {
      projectName: currentProject.value?.name,
      startVmId,
      defaultStorage,
    }
  )

  if (result.needsConfiguration) {
    showToast('Please configure Backend API settings first', 'warning')
    showProxmoxSettings.value = true
    return
  }

  if (!result.success) {
    validationErrors.value = result.errors
    const errorSummary = result.errors.slice(0, 3).map(e => e.message).join('; ')
    const suffix = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''
    showToast(`Validation failed: ${errorSummary}${suffix}`, 'error', 6000)
    return
  }

  showDeploymentPanel.value = true
}

const handleOpenValidate = () => {
  const result = deployment.validateTopology(liveNodes.value, liveEdges.value)
  
  if (result.valid) {
    showToast('Topology is valid! No errors found.', 'success')
  } else {
    const errorSummary = result.errors.slice(0, 3).map(e => e.message).join('; ')
    const suffix = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''
    showToast(`Validation: ${errorSummary}${suffix}`, 'error', 6000)
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

// ------------------------------------------------------------
// Tab shell (Plan C C3.6)
// ------------------------------------------------------------
// Tabs are local state driven by the URL query (?tab=…). Switching tabs is a
// router.replace — cheap, preserves history — and canvas / config panes use
// v-show so viewport, selection, undo buffers, and CodeMirror state survive
// cross-tab navigation.
const TABS = ['canvas', 'config', 'variables', 'history', 'settings']
const tab = computed(() => {
  const q = route.query.tab
  const v = Array.isArray(q) ? q[0] : q
  return TABS.includes(String(v)) ? String(v) : 'canvas'
})

function setTab(next) {
  if (!TABS.includes(next)) return
  if (route.query.tab === next) return
  router.replace({ query: { ...route.query, tab: next } })
}

// Provide project state + a thin adapter to descendant tab panels (variables,
// history, settings panels land in later phases — giving them a stable
// provide/inject contract now keeps the contract self-documenting).
provide('projectAdapter', {
  getProject: () => currentProject.value,
  getNodes: () => liveNodes.value,
  getEdges: () => liveEdges.value,
  setTab,
})

// ------------------------------------------------------------
// Config tab file-system wiring (C3.7)
// ------------------------------------------------------------
// Two in-memory VirtualFs stores: one for the project's local overlay
// (persisted alongside project.files), and an empty base for now (the
// base filesystem will be wired to the catalog source in a later task).
// Using refs so FileTree picks up changes reactively on putFile.
const overlayFiles = computed(() => currentProject.value?.files || {})
const baseFiles = ref({})

const configOverlayFs = computed(() =>
  createMemoryFs({
    files: overlayFiles.value || {},
    onChange: (files) => {
      if (!currentProject.value) return
      currentProject.value.files = { ...files }
      projectStore.updateProject(currentProject.value.id, {
        files: currentProject.value.files,
      })
    },
  }),
)
const configBaseFs = computed(() => createMemoryFs({ files: baseFiles.value }))

function handleConfigSave() {
  // onChange in memoryFs already persists; this hook exists so future git-
  // backed adapters can trigger an autosave/commit here without touching
  // the child component contract.
}

function handleAttachmentsUpdate(next) {
  if (!currentProject.value) return
  currentProject.value.attachments = next
  projectStore.updateProject(currentProject.value.id, {
    attachments: next,
  })
}

// HistoryTab wiring (C3.9). When the project is linked to a git source
// (`project.gitSource = { provider, owner, repo, path, ref }`), we return
// a live provider + locator. Otherwise the tab shows an empty-state hint.
const historyProvider = computed(() => {
  const src = currentProject.value?.gitSource
  if (!src?.provider) return null
  try {
    if (src.provider === 'github') {
      // GitHub uses the legacy provider interface; it also exposes
      // `listCommits` + `getFile` — adapt the call shape here so
      // HistoryTab can talk to it via the same surface as GitLab/Gitea.
      const gh = getGitProvider('github')
      return {
        listCommits: (opts) => gh.listCommits(opts),
        getFile: async (opts) => {
          const content = await gh.getFile(opts.owner, opts.repo, opts.path, opts.ref)
          return { content, sha: '' }
        },
      }
    }
    return getV1Provider(src.provider, {
      baseUrl: src.baseUrl,
      token: src.token ?? null,
    })
  } catch {
    return null
  }
})

// VariablesTab wiring (C3.10). The effective env[] comes from the catalog
// base doc embedded in the project (`project.baseDoc`) — missing today for
// legacy projects, so we fall back to an empty list. Overrides are
// persisted on `project.overlay.param_overrides.env`.
const variablesBase = computed(() => currentProject.value?.baseDoc || { env: [] })
const variablesOverlay = computed(() => currentProject.value?.overlay || {})

function handleOverlayUpdate(nextOverlay) {
  if (!currentProject.value) return
  currentProject.value.overlay = nextOverlay
  projectStore.updateProject(currentProject.value.id, {
    overlay: nextOverlay,
  })
}

const historyLocator = computed(() => {
  const src = currentProject.value?.gitSource
  if (!src?.owner || !src?.repo) return null
  return {
    owner: src.owner,
    repo: src.repo,
    path: src.path || 'range42.yaml',
    ref: src.ref || 'main',
  }
})

// Import config: resolved from per-project settings at setup level
const importApiConfig = useApiConfig(projectId, { autoSync: true })

// Provide API config to child components (ConfigPanel, etc.)
provide('apiConfig', importApiConfig)

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
  <div>
  <div class="h-screen bg-base-100 flex" v-if="currentProject">
    <!-- Sidebar -->
    <Sidebar 
      :project="currentProject" 
      @openExport="showExportModal = true"
      @openDeploy="handleOpenDeploy"
      @openValidate="handleOpenValidate"
      @openInventory="router.push('/catalog')"
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
          <!-- Organize layout button -->
          <button class="btn btn-ghost btn-sm gap-1" @click="handleAutoLayout" title="Organize topology layout">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path>
            </svg>
            <span class="hidden sm:inline">Organize</span>
          </button>

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


      <!-- Tab strip -->
      <div role="tablist" class="tabs tabs-lift px-3 pt-1 border-b border-base-300" data-testid="project-tabs">
        <button
          v-for="t in ['canvas', 'config', 'variables', 'history', 'settings']"
          :key="t"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': tab === t }"
          :aria-selected="tab === t"
          :data-testid="`project-tab-${t}`"
          @click="setTab(t)"
        >
          {{ t }}
        </button>
      </div>

      <!-- VueFlow Canvas (v-show keeps state across tab switches) -->
      <div
        v-show="tab === 'canvas'"
        class="flex-1 relative transition-colors duration-200"
        :class="{ 'bg-primary/5 ring-2 ring-primary/20 ring-inset': isDragOver }"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
      >
        <VueFlow
          :nodes="nodes"
          :edges="renderedEdges"
          @connect="onConnect" 
          @node-click="handleNodeClick"
          @edge-click="handleEdgeClick" 
          @nodes-change="onNodesChange" 
          @edges-change="onEdgesChange" 
          fit-view-on-init 
          elevate-edges-on-select 
          class="h-full w-full"
        >
          <NetworkZoneOverlay :zones="zones" />
          <Background />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" />

          <!-- Organization -->
          <template #node-group="props">
            <GroupNode
              v-bind="props"
              @update:kind="(kind) => updateNodeStatus(props.id, { kind })"
              @update:scope="(kind) => updateNodeStatus(props.id, { kind })"
              @update:expanded="(open) => updateNodeStatus(props.id, { _expanded_preview: open })"
            />
          </template>

          <!-- Compute -->
          <template #node-vm="props">
            <InfraNodeVm v-bind="props" />
          </template>

          <template #node-lxc="props">
            <InfraNodeLxc v-bind="props" />
          </template>

          <template #node-docker="props">
            <DockerNode v-bind="props" />
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

          <!-- Dashed containment tether: Docker -> VM/LXC host -->
          <template #edge-docker-tether="props">
            <DockerTetherEdge v-bind="props" />
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

      <!-- Problems panel — docked below canvas, reactive over validation state -->
      <ProblemsPanel
        v-if="showProblemsPanel"
        v-show="tab === 'canvas'"
        :problems="problemList"
        class="shrink-0"
        @jumpTo="handleJumpTo"
        @close="showProblemsPanel = false"
      />

      <!-- Config tab (C3.7) — FileTree + TwoPaneEditor + AttachmentManager -->
      <div v-show="tab === 'config'" class="flex-1 min-h-0 overflow-hidden" data-testid="tab-config">
        <ConfigTab
          v-if="currentProject"
          :overlay-fs="configOverlayFs"
          :base-fs="configBaseFs"
          :attachments="attachmentsRef"
          :nodes="liveNodes"
          @update:attachments="handleAttachmentsUpdate"
          @save="handleConfigSave"
        />
      </div>

      <!-- Variables tab (C3.10) -->
      <div v-show="tab === 'variables'" class="flex-1 min-h-0 overflow-hidden" data-testid="tab-variables">
        <VariablesTab
          v-if="currentProject"
          :base="variablesBase"
          :overlay="variablesOverlay"
          @update:overlay="handleOverlayUpdate"
        />
      </div>

      <!-- History tab (C3.9) -->
      <div v-show="tab === 'history'" class="flex-1 min-h-0 overflow-hidden" data-testid="tab-history">
        <HistoryTab
          v-if="historyProvider && historyLocator"
          :provider="historyProvider"
          :locator="historyLocator"
        />
        <div v-else class="p-4 text-sm text-base-content/60">
          {{ $t ? $t('historyTab.noSource') : 'Link this project to a git source to see its history.' }}
        </div>
      </div>

      <!-- Settings tab placeholder -->
      <div v-show="tab === 'settings'" class="flex-1 overflow-y-auto p-4" data-testid="tab-settings">
        <div class="alert alert-info text-sm">
          Settings tab — per-project settings live here in a later phase.
        </div>
      </div>
    </div>

    <!-- Config Panel (node config — only on canvas tab) -->
    <ConfigPanel
      v-if="selectedNode && showConfigPanel && tab === 'canvas'"
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

    <!-- Plan C §C4.6 — DeployForm with inline preflight + SHA-pin -->
    <DeployForm
      v-if="showDeployForm && currentProject"
      :visible="showDeployForm"
      :project-id="currentProject.id"
      :project-name="currentProject.name"
      :catalog-sha="currentProject?.catalog_sha || currentProject?.pinned_catalog_sha || ''"
      :project-sha="currentProject?.head_sha || currentProject?.project_sha || ''"
      :existing-codenames="existingCodenames"
      :gamenet="!!currentProject?.gamenet"
      @close="showDeployForm = false"
      @created="refreshActiveDeployment"
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

  <!-- Modals teleported to body so they're not constrained by the flex layout -->
  <Teleport to="body">
    <TemplateBrowser
      v-if="showTemplateBrowser"
      :api-url="importApiConfig.apiUrl.value"
      :proxmox-node="importApiConfig.node.value"
      @close="showTemplateBrowser = false"
    />

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

    <!-- Command palette (Ctrl/Cmd-P) — body-teleported by the component itself -->
    <CommandPalette
      :open="showCommandPalette"
      :items="paletteItems"
      @update:open="showCommandPalette = $event"
      @close="showCommandPalette = false"
      @jumpTo="handleJumpTo"
    />
  </Teleport>
  </div>
</template>

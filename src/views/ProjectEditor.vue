<script setup>
import { ref, onMounted, onUnmounted, watch, computed, provide, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
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
import InfrastructureImportModal from '../components/InfrastructureImportModal.vue'
import TemplateBrowser from '../components/TemplateBrowser.vue'
import ProblemsPanel from '../components/project/ProblemsPanel.vue'
import ActivityTerminal from '../components/project/ActivityTerminal.vue'
import CommandPalette from '../components/project/CommandPalette.vue'
import ConfigTab from '../components/project/ConfigTab.vue'
import HistoryTab from '../components/project/HistoryTab.vue'
import VariablesTab from '../components/project/VariablesTab.vue'
import { useDeploymentIndex } from '@/composables/useDeploymentIndex'
import { getBackendScope } from '@/services/backendApi'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import ScenarioAuthoringModal from '@/components/project/ScenarioAuthoringModal.vue'
import ProjectRepositoryConnection from '@/components/ProjectRepositoryConnection.vue'
import { emitConcreteScenario } from '@/services/concreteScenario'
import { ensureBackendProject } from '@/services/backendProjectRegistration'
import { buildProjectFiles } from '@/composables/useProjectGitSync'
import DeployForm from '../components/project/DeployForm.vue'
import { createMemoryFs } from '../services/projectRepo/memoryFs'
import { ensureNamespaces } from '../i18n'
import { useCanvasHistory } from '../composables/useCanvasHistory'
import { getProvider as getV1Provider, getGitProvider } from '../services/git'
import { useProblems } from '../composables/useProblems'
import { useDeploymentActivityBridge } from '@/composables/useDeploymentActivityBridge'
import { useHotkeys } from '../composables/useHotkeys'

import { useAutoLayout } from '../composables/useAutoLayout'
import { useNetworkZones } from '../composables/useNetworkZones'
import { useCanvasLiveStatus } from '../composables/useCanvasLiveStatus'
import { useDeploymentStore } from '../stores/deploymentStore.ts'
import NetworkZoneOverlay from '../components/NetworkZoneOverlay.vue'
import { useInfraBuilder, computeDockerTetherEdges, nextKeyboardSelection, normalizeAttachment } from '../composables/useInfraBuilder'
import { useTopologyResolver } from '../composables/useTopologyResolver'
import { useApiConfig } from '../composables/useApiConfig'
import { useWebSocketStatus } from '../composables/useWebSocketStatus'
// setBaseUrl is managed via useApiConfig composable
import { useDragAndDrop } from '../composables/useDragAndDrop'
import { useToast } from '../composables/useToast'
import { useProjectGitSync, buildPushArgs } from '../composables/useProjectGitSync'
import { useProjectStore } from '../stores/projectStore'


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

const { getNodes: flowGetNodes, getEdges: flowGetEdges, addNodes: vfAddNodes, addEdges: vfAddEdges, updateNodeData, onNodesInitialized, findNode } = useVueFlow()

// Bumped when VueFlow finishes measuring node dimensions, so the network-zone
// overlay recomputes its geometry off real (not fallback) sizes on first paint.
const measureTick = ref(0)
onNodesInitialized(() => { measureTick.value++ })

const { showToast } = useToast()
const gitSync = useProjectGitSync()
const { t: translate } = useI18n({ useScope: 'global' })
const gitSaving = ref(0)
const gitSaveError = ref('')
const showPublishTargets = ref(false)
const publicationFiles = ref({})
const showScenarioAuthoring = ref(false)
const showRepositoryConnection = ref(false)
const registeredProjectId = ref('')
const dragAndDropComposable = useDragAndDrop()
const { onDragOver, onDrop, onDragLeave, isDragOver } = dragAndDropComposable || {}

const showConfigPanel = ref(false)
const configPanelRef = ref(null)
const showExportModal = ref(false)
const showProxmoxSettings = ref(false)
// Plan C §C4.6 — new-style DeployForm with inline preflight + SHA-pin.
const showDeployForm = ref(false)
const deploymentIndex = useDeploymentIndex()
const existingCodenames = computed(() => deploymentIndex.items.value.map(item => item.codename))
const showTemplateBrowser = ref(false)
const showImportModal = ref(false)
const showDeleteProjectModal = ref(false)
const deleteConfirmName = ref('')
const currentProject = ref(null)

// Project ID as computed ref for composables
const projectId = computed(() => currentProject.value?.id || route.params.id)

// Deployment composable - now auto-uses project settings
const topologyResolver = useTopologyResolver()

const liveNodes = computed(() => (flowGetNodes?.value && flowGetNodes.value.length ? flowGetNodes.value : nodes.value) || [])
const liveEdges = computed(() => (flowGetEdges?.value && flowGetEdges.value.length ? flowGetEdges.value : edges.value) || [])

// Docker containment tethers are derived from docker.data.host_ref — they are
// rendered alongside user-authored edges but never persisted.
const dockerTetherEdges = computed(() => computeDockerTetherEdges(liveNodes.value))
const renderedEdges = computed(() => [...(edges.value || []), ...dockerTetherEdges.value])

// Problems panel — reactive over the live canvas graph.
const attachmentsRef = computed(() =>
  (currentProject.value?.attachments || []).map(normalizeAttachment),
)
const { problems: problemList } = useProblems(liveNodes, liveEdges, attachmentsRef)
const showProblemsPanel = ref(true)

// Unified activity terminal — Proxmox + deploy feed. The bridge forwards
// deployment SSE events into the shared activity log (cleans up on unmount).
const showActivityTerminal = ref(true)
useDeploymentActivityBridge()

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
  const files = currentProject.value?.files || {}
  const filePaths = Array.isArray(files) ? files.map(file => file.path).filter(Boolean) : Object.keys(files)
  for (const path of filePaths) {
    items.push({
      id: `file:${path}`,
      kind: 'file',
      label: path.split('/').pop() || path,
      subtitle: path,
      jumpTo: { kind: 'file', id: path },
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

const { zones } = useNetworkZones(liveNodes, liveEdges, measureTick)

const autoLayout = useAutoLayout()

// Plan C §C4.7 — Canvas live status from SSE stream.
// Finds the active (non-terminal) deployment for this project, subscribes
// to its SSE stream, and mirrors per-node status into VueFlow node data.
const deploymentStore = useDeploymentStore()
const activeDeploymentId = ref(null)
const TERMINAL_STATES_CANVAS = new Set(['succeeded', 'deployed', 'failed', 'cancelled', 'torn_down'])

async function refreshActiveDeployment() {
  await deploymentIndex.load()
}

watch([deploymentIndex.items, projectId], ([items, pid]) => {
  const active = items.find(d => d.project_id === pid && !TERMINAL_STATES_CANVAS.has(d.state))
  if (active?.id !== activeDeploymentId.value) {
    if (activeDeploymentId.value) deploymentStore.unsubscribe(activeDeploymentId.value)
    activeDeploymentId.value = active?.id || null
    if (activeDeploymentId.value) deploymentStore.subscribe(activeDeploymentId.value)
  }
}, { immediate: true })

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

    // Runtime status: always sync
    if (node.data.status !== newStatus) {
      dataUpdate.status = newStatus
      needsUpdate = true
    }

    // Live metrics: always sync
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

    // For deployed nodes: update actualConfig (not top-level tags)
    if (node.data.deployed) {
      const wsTags = vm.tags ? vm.tags.split(';').filter(Boolean) : []
      const currentActual = node.data.actualConfig || {}

      const newActual = {
        ...currentActual,
        tags: wsTags,
        name: vm.name,
        cores: vm.cores || currentActual.cores,
        memory: vm.maxmem ? Math.floor(vm.maxmem / 1024 / 1024) : currentActual.memory,
      }

      if (JSON.stringify(newActual) !== JSON.stringify(currentActual)) {
        dataUpdate.actualConfig = newActual
        needsUpdate = true
      }

      // Initialize desiredConfig on first sync if missing
      if (!node.data.desiredConfig) {
        dataUpdate.desiredConfig = {
          ...newActual,
          cores: node.data.config?.cores ? Number(node.data.config.cores) : undefined,
          memory: typeof node.data.config?.memory === 'string'
            ? parseInt(node.data.config.memory)
            : node.data.config?.memory,
        }
        needsUpdate = true
      }
    } else {
      // Non-deployed nodes: sync tags to top-level (legacy behavior for draft nodes)
      if (vm.tags) {
        const wsTags = vm.tags.split(';').filter(Boolean)
        const currentTags = node.data.tags || []
        if (JSON.stringify(wsTags) !== JSON.stringify(currentTags)) {
          dataUpdate.tags = wsTags
          needsUpdate = true
        }
      }
    }

    if (needsUpdate) {
      updateNodeData(node.id, dataUpdate)
    }
  }
}, { deep: true })

////

onMounted(() => {
  if (!projectStore.projects.length) projectStore.loadProjects()
  const project = projectStore.getProject(route.params.id)
  if (!project) {
    router.push('/')
    return
  }

  currentProject.value = project
  loadProjectData(project)
  ensureNamespaces(['configTab', 'historyTab', 'variablesTab', 'project', 'common'])
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
    if (currentProject.value.git && !showRepositoryConnection.value) void manualSave({ quiet: true })
  }, 1500)
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

function currentPushArgs() {
  const project = currentProject.value
  const generated = project?.scenario ? emitConcreteScenario({
    scenario: project.scenario, nodes: liveNodes.value, edges: liveEdges.value,
    files: project.files, attachments: project.attachments,
    baseDoc: project.baseDoc, overlay: project.overlay,
    generatedPaths: project.scenario_generated_paths || [],
  }) : null
  return buildPushArgs(generated ? { ...project, files: generated.files } : project, liveNodes.value, liveEdges.value,
    `Save ${currentProject.value?.name || 'project'}`)
}

function recordCheckpoint(result, project = currentProject.value) {
  if (!project?.git || !result.commit_sha) return
  const git = { ...project.git, ...(result.binding || {}), working_branch: result.branch,
    ...(result.targets ? { publish_results: result.targets } : {}) }
  projectStore.updateProject(project.id, { head_sha: result.commit_sha, git })
  if (currentProject.value?.id === project.id) {
    currentProject.value.head_sha = result.commit_sha
    currentProject.value.git = git
  }
}

function recordPublicationReview(result) {
  const project = currentProject.value
  if (!project?.git) return
  const previous = project.git.publish_results || []
  const results = previous.filter(item => item.target_id !== result.target_id)
  projectStore.updateProject(project.id, { git: { ...project.git, publish_results: [...results, result] } })
}

const manualSave = async ({ quiet = false } = {}) => {
  const project = currentProject.value
  if (!project) return null
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
  projectStore.updateProject(project.id, { nodes: liveNodes.value, edges: liveEdges.value })
  gitSaving.value += 1
  gitSaveError.value = ''
  try {
    const args = currentPushArgs()
    if (!args) return null
    if (project.scenario) projectStore.updateProject(project.id, { files: args.files })
    const result = await gitSync.pushToGit(args)
    recordCheckpoint(result, project)
    if (!quiet) showToast(translate('project.git.saved', { branch: result.branch, sha: result.commit_sha.slice(0, 7) }), 'success')
    return result
  } catch (error) {
    gitSaveError.value = error?.message || String(error)
    if (!quiet) showToast(translate('project.git.failed', { error: gitSaveError.value }), 'error', 6000)
    return null
  } finally {
    gitSaving.value -= 1
  }
}

function openPublishTargets() {
  try {
    const args = currentPushArgs()
    if (!args) return
    publicationFiles.value = buildProjectFiles(args)
    showPublishTargets.value = true
  } catch (error) { showToast(error.message || String(error), 'error', 6000) }
}

function applyScenario(result) {
  if (!currentProject.value) return
  projectStore.updateProject(currentProject.value.id, {
    scenario: result.scenario, files: result.files, scenario_generated_paths: result.generatedPaths,
  })
  showScenarioAuthoring.value = false
  void manualSave()
}

function openRepositoryConnection() {
  if (gitSaving.value > 0) return
  if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null }
  showRepositoryConnection.value = true
}

function connectProjectRepository(binding) {
  if (!currentProject.value || gitSaving.value > 0) return
  const identity = git => JSON.stringify([git?.source_id, git?.provider, git?.base_url,
    git?.repo_owner, git?.repo_name, git?.branch || 'main', git?.subdir || ''])
  const changed = identity(binding) !== identity(currentProject.value.git)
  projectStore.updateProject(currentProject.value.id, {
    git: binding, ...(changed ? { head_sha: '', project_sha: '' } : {}),
  })
  if (changed) registeredProjectId.value = ''
  showRepositoryConnection.value = false
}

function updatePublicationTargets(targets) {
  if (!currentProject.value?.git) return
  currentProject.value.git = { ...currentProject.value.git, publish_targets: targets }
  projectStore.updateProject(currentProject.value.id, { git: currentProject.value.git })
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

// Node-card "Apply" strip → open that node's ConfigPanel and surface the apply dialog.
const onNodeApply = (slotProps) => {
  const n = findNode(slotProps.id)
  if (!n) return
  selectedNode.value = n
  showConfigPanel.value = true
  nextTick(() => configPanelRef.value?.openApplyDialog?.())
}

/**
 * Keyboard navigation on the canvas (Plan C §C5.3):
 *  - Arrow keys move selection to the nearest node in that cardinal direction.
 *  - Enter opens the ConfigPanel for the currently-selected node.
 *  - Tab is intentionally NOT consumed so native handle-focus cycling still
 *    works inside VueFlow.
 * The handler only reacts when the canvas wrapper (or one of its children
 * that isn't an editable control) is the active element — preventing
 * interference with mouse interactions and form inputs.
 */
// Mobile sidebar drawer state (Plan C §C5.3 — a11y wiring for <lg screens).
// Focus management: when the drawer opens we move focus inside it; Escape
// closes. aria-expanded on the toggle reflects open state.
const mobileSidebarOpen = ref(false)
const mobileSidebarRef = ref(null)
function toggleMobileSidebar() {
  mobileSidebarOpen.value = !mobileSidebarOpen.value
  if (mobileSidebarOpen.value) {
    // Focus the drawer container so Tab cycles inside and Escape is captured
    setTimeout(() => mobileSidebarRef.value?.focus?.(), 0)
  }
}
function closeMobileSidebar() {
  mobileSidebarOpen.value = false
}
function handleMobileSidebarKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMobileSidebar()
  }
}

const ARROW_DIRS = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
}

const handleCanvasKeydown = (event) => {
  const target = event.target
  if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable)) {
    return
  }

  if (event.key === 'Enter') {
    if (selectedNode.value) {
      showConfigPanel.value = true
      event.preventDefault()
    }
    return
  }

  const dir = ARROW_DIRS[event.key]
  if (!dir) return

  const allNodes = flowGetNodes.value || nodes.value || []
  const next = nextKeyboardSelection(allNodes, selectedNode.value?.id || null, dir)
  if (next) {
    selectedNode.value = next
    event.preventDefault()
  }
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

const handleOpenDeploy = async () => {
  const scope = getBackendScope()
  try {
    const args = currentPushArgs()
    const before = args ? JSON.stringify(buildProjectFiles(args)) : null
    if (args) {
      const saved = await manualSave()
      if (!saved || scope !== getBackendScope()) return
      const registered = await ensureBackendProject(currentProject.value)
      if (scope !== getBackendScope()) return
      registeredProjectId.value = registered.id
    } else registeredProjectId.value = currentProject.value?.id || ''
    await deploymentIndex.load()
    if (scope !== getBackendScope()) return
    const currentArgs = currentPushArgs()
    if (before !== null && (!currentArgs || before !== JSON.stringify(buildProjectFiles(currentArgs)))) {
      showToast(translate('project.git.changedDuringSave'), 'warning', 6000)
      return
    }
    showDeployForm.value = true
  } catch (error) { showToast(error.message || String(error), 'error', 6000) }
}

const handleOpenValidate = () => {
  const result = topologyResolver.validateTopology(liveNodes.value, liveEdges.value)
  
  if (result.valid) {
    showToast('Topology is valid! No errors found.', 'success')
  } else {
    const errorSummary = result.errors.slice(0, 3).map(e => e.message).join('; ')
    const suffix = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : ''
    showToast(`Validation: ${errorSummary}${suffix}`, 'error', 6000)
  }
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
      scheduleAutosave()
    },
  }),
)
const configBaseFs = computed(() => createMemoryFs({ files: baseFiles.value }))

function handleConfigSave() {
  void manualSave()
}

function handleAttachmentsUpdate(next) {
  if (!currentProject.value) return
  currentProject.value.attachments = next
  projectStore.updateProject(currentProject.value.id, {
    attachments: next,
  })
  scheduleAutosave()
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
  scheduleAutosave()
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
    <!-- Sidebar (desktop ≥lg) -->
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

    <!-- Mobile drawer (<lg). Focus moves into the drawer on open; Escape closes. -->
    <div
      v-if="mobileSidebarOpen"
      id="mobile-drawer"
      class="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation drawer"
      data-testid="mobile-drawer"
      @keydown="handleMobileSidebarKeydown"
    >
      <div class="absolute inset-0 bg-black/50" @click="closeMobileSidebar" />
      <div
        ref="mobileSidebarRef"
        tabindex="-1"
        class="absolute left-0 top-0 h-full w-72 bg-base-100 shadow-xl flex focus:outline-none"
      >
        <Sidebar
          :project="currentProject"
          class="w-full"
          @openExport="showExportModal = true; closeMobileSidebar()"
          @openDeploy="(p) => { handleOpenDeploy(p); closeMobileSidebar() }"
          @openValidate="handleOpenValidate(); closeMobileSidebar()"
          @openInventory="router.push('/catalog'); closeMobileSidebar()"
          @openTemplates="showTemplateBrowser = true; closeMobileSidebar()"
          @openImport="handleOpenImport(); closeMobileSidebar()"
        />
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Top Bar -->
      <header class="min-h-14 px-3 py-2 sm:px-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-base-300 bg-base-100 shrink-0">
        <div class="flex w-full min-w-0 items-center gap-3 sm:w-auto">
          <!-- Mobile menu toggle -->
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square lg:hidden"
            :aria-expanded="mobileSidebarOpen ? 'true' : 'false'"
            aria-controls="mobile-drawer"
            aria-label="Toggle navigation"
            data-testid="mobile-drawer-toggle"
            @click="toggleMobileSidebar"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
          
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
        <div class="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <!-- Organize layout button -->
          <button class="btn btn-ghost btn-sm gap-1" @click="handleAutoLayout" title="Organize topology layout">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path>
            </svg>
            <span class="hidden sm:inline">Organize</span>
          </button>

          <!-- Save button -->
          <button type="button" class="btn btn-ghost btn-sm" data-testid="project-repository" :disabled="gitSaving > 0" @click="openRepositoryConnection">Repository</button>
          <button type="button" class="btn btn-outline btn-sm" data-testid="project-scenario" @click="showScenarioAuthoring = true">Scenario</button>
          <button class="btn btn-ghost btn-sm gap-2" :disabled="gitSaving > 0" @click="manualSave()" title="Save (Ctrl+S)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path>
            </svg>
            <span class="hidden sm:inline">Save</span>
          </button>
          
          <button v-if="currentProject?.git" type="button" class="btn btn-outline btn-sm"
            data-testid="project-publish" :disabled="gitSaving > 0" @click="openPublishTargets">
            {{ translate('project.git.publish') }}
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


      <div v-if="currentProject?.git" class="px-3 py-1 text-xs text-base-content/70" data-testid="project-git-status">
        <span v-if="gitSaving">{{ translate('project.git.saving') }}</span>
        <span v-else-if="gitSaveError" role="alert" class="text-error">{{ gitSaveError }}</span>
        <span v-else-if="currentProject.head_sha">{{ translate('project.git.saved', { branch: currentProject.git.working_branch || '—', sha: currentProject.head_sha.slice(0, 7) }) }}</span>
      </div>

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
        class="flex-1 relative transition-colors duration-200 focus:outline-none"
        :class="{ 'bg-primary/5 ring-2 ring-primary/20 ring-inset': isDragOver }"
        tabindex="0"
        role="application"
        aria-label="Infrastructure canvas"
        data-testid="canvas-wrapper"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @keydown="handleCanvasKeydown"
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
            <InfraNodeVm v-bind="props" @open-apply-dialog="onNodeApply(props)" />
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

      <!-- Activity terminal — unified Proxmox + deploy feed, docked beside Problems -->
      <ActivityTerminal
        v-if="showActivityTerminal"
        v-show="tab === 'canvas'"
        class="shrink-0"
        @close="showActivityTerminal = false"
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
      ref="configPanelRef"
      v-if="selectedNode && showConfigPanel && tab === 'canvas'"
      :node="selectedNode"
      :attachments="attachmentsRef"
      :nodes="liveNodes"
      @close="closeConfigPanel"
      @update="updateNodeStatus"
      @delete="handleDeleteNode"
      @update:attachments="handleAttachmentsUpdate"
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
    

    <ProjectRepositoryConnection v-if="showRepositoryConnection && currentProject" :open="showRepositoryConnection"
      :binding="currentProject.git" @close="showRepositoryConnection = false" @connected="connectProjectRepository" />

    <ScenarioAuthoringModal v-if="showScenarioAuthoring && currentProject" :open="showScenarioAuthoring"
      :project="currentProject" :nodes="liveNodes" :edges="liveEdges"
      @close="showScenarioAuthoring = false" @generated="applyScenario" />

    <PublishTargetsModal
      v-if="showPublishTargets && currentProject?.git"
      :open="showPublishTargets" :project-id="currentProject.id" :binding="currentProject.git"
      :files="publicationFiles" :message="`Publish ${currentProject.name}`"
      :initial-targets="currentProject.git.publish_targets || []"
      @close="showPublishTargets = false" @published="recordCheckpoint" @reviewed="recordPublicationReview"
      @update:targets="updatePublicationTargets"
    />

    <!-- Plan C §C4.6 — DeployForm with inline preflight + SHA-pin -->
    <DeployForm
      v-if="showDeployForm && currentProject"
      :visible="showDeployForm"
      :project-id="registeredProjectId || currentProject.id"
      :project-name="currentProject.name"
      :initial-scenario-label="currentProject.scenario?.label || ''"
      :allocation="currentProject.scenario?.allocation || null"
      :catalog-sha="currentProject?.catalog_sha || currentProject?.pinned_catalog_sha || ''"
      :project-sha="currentProject?.head_sha || currentProject?.project_sha || ''"
      :existing-codenames="existingCodenames"
      :gamenet="!currentProject.scenario && !!currentProject?.gamenet"
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

<script setup>
// @ts-check
import { ref, onMounted, onBeforeUnmount, onUnmounted, watch, computed, provide, nextTick, defineAsyncComponent } from 'vue'
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
import HistoryTab from '../components/project/HistoryTab.vue'
import VariablesTab from '../components/project/VariablesTab.vue'
import { useDeploymentIndex } from '@/composables/useDeploymentIndex'
import { getBackendScope } from '@/services/backendApi'
import PublishTargetsModal from '@/components/PublishTargetsModal.vue'
import ScenarioAuthoringModal from '@/components/project/ScenarioAuthoringModal.vue'
import { reviewedScenarioUpdates } from '@/services/attachmentMigration'
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
import SidebarDrawer from '@/components/ui/SidebarDrawer.vue'

import { useAutoLayout } from '../composables/useAutoLayout'
import { useNetworkZones } from '../composables/useNetworkZones'
import { useCanvasLiveStatus } from '../composables/useCanvasLiveStatus'
import { useDeploymentStore } from '../stores/deploymentStore'
import NetworkZoneOverlay from '../components/NetworkZoneOverlay.vue'
import { useInfraBuilder, computeDockerTetherEdges, nextKeyboardSelection, normalizeAttachment } from '../composables/useInfraBuilder'
import { useTopologyResolver } from '../composables/useTopologyResolver'
import { useApiConfig } from '../composables/useApiConfig'
import { useObservedGuestStatus } from '@/composables/useObservedGuestStatus'
import { prepareEditorBranchRecovery, editorAuthoredSignature } from '@/services/gitEditorRecovery'
const ConfigTab = defineAsyncComponent(() => import('../components/project/ConfigTab.vue'))

// setBaseUrl is managed via useApiConfig composable
import { useDragAndDrop } from '../composables/useDragAndDrop'
import { useToast } from '../composables/useToast'
import { useProjectGitSync, buildPushArgs, providerForBinding } from '../composables/useProjectGitSync'
import { useProjectStore } from '../stores/projectStore'
import { useEditorPreferencesStore } from '@/stores/editorPreferencesStore'


////

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const editorPreferences = useEditorPreferencesStore()
const editorSnapGrid = computed(() => /** @type {[number, number]} */ ([editorPreferences.gridSize, editorPreferences.gridSize]))

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
provide('projectGitSync', gitSync)
const gitLockBlocked = computed(() => gitSync.lockStatus?.value === 'blocked')
const gitLockError = computed(() => gitSync.lockError?.value || '')
const { t: translate } = useI18n({ useScope: 'global' })
const gitSaving = ref(0)
const gitSaveError = ref('')
const showPublishTargets = ref(false)
const publicationFiles = ref({})
const publicationRevision = ref('')
const publicationBinding = ref('')
const showScenarioAuthoring = ref(false)
const scenarioContentTarget = ref('')
const showRepositoryConnection = ref(false)
const registeredProjectId = ref('')
const dragAndDropComposable = useDragAndDrop()
const { onDragOver, onDrop, onDragLeave, isDragOver, addComponent } = dragAndDropComposable || {}

const showConfigPanel = ref(false)
/** @type {import('vue').Ref<{ openApplyDialog: () => void } | null>} */
const configPanelRef = ref(null)
const showExportModal = ref(false)
const showProxmoxSettings = ref(false)
const projectActionsOpen = ref(false)
/** @type {import('vue').Ref<HTMLDetailsElement | null>} */
const projectActionsMenu = ref(null)
function syncProjectActions() { projectActionsOpen.value = projectActionsMenu.value?.open || false }
function closeProjectActions() {
  projectActionsOpen.value = false
  projectActionsMenu.value?.querySelector('summary')?.focus()
}
// Plan C §C4.6 — new-style DeployForm with inline preflight + SHA-pin.
const showDeployForm = ref(false)
const deploymentIndex = useDeploymentIndex()
const existingCodenames = computed(() => deploymentIndex.items.value.map(item => item.codename))
const showTemplateBrowser = ref(false)
const showImportModal = ref(false)
const showDeleteProjectModal = ref(false)
const deleteConfirmName = ref('')
/** @type {import('vue').Ref<import('@/types/project').ProjectDraft | null>} */
const currentProject = ref(null)

// Project ID as computed ref for composables
const projectId = computed(() => currentProject.value?.id || queryText(route.params.id))

// Deployment composable - now auto-uses project settings
const topologyResolver = useTopologyResolver()

const liveNodes = computed(() => (flowGetNodes?.value && flowGetNodes.value.length ? flowGetNodes.value : nodes.value) || [])
const liveEdges = computed(() => (flowGetEdges?.value && flowGetEdges.value.length ? flowGetEdges.value : edges.value) || [])

/**
 * Copy VueFlow rows to the project's plain object boundary without dropping
 * local desired configuration or observed metadata.
 * @param {import('@vue-flow/core').Node[]} [graphNodes]
 * @param {import('@vue-flow/core').Edge[]} [graphEdges]
 */
function projectGraph(graphNodes = liveNodes.value, graphEdges = liveEdges.value) {
  return { nodes: graphNodes.map(node => ({ ...node })), edges: graphEdges.map(edge => ({ ...edge })) }
}


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

// Project search is opened by its visible toolbar button.
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


/** @param {import('@/composables/useProblems').Problem['jumpTo']} descriptor */
function handleJumpTo(descriptor) {
  if (!descriptor) return
  if (descriptor.kind === 'node') {
    const n = (liveNodes.value || []).find((x) => x.id === descriptor.id)
    if (n) {
      router.push({ query: { ...route.query, tab: 'canvas', node: n.id } })
    }
  } else if (descriptor.kind === 'file') {
    router.push({ query: { ...route.query, tab: 'config', file: descriptor.id } })
  } else if (descriptor.kind === 'edge') {
    const e = (liveEdges.value || []).find((x) => x.id === descriptor.id)
    if (e) { selectedEdge.value = e; setTab('canvas') }
  }
}

const { zones } = useNetworkZones(liveNodes, liveEdges, measureTick)

const autoLayout = useAutoLayout()

// Plan C §C4.7 — Canvas live status from SSE stream.
// Finds the active (non-terminal) deployment for this project, subscribes
// to its SSE stream, and mirrors per-node status into VueFlow node data.
const deploymentStore = useDeploymentStore()
/** @type {import('vue').Ref<string | null>} */
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
/** @param {import('@/composables/useCanvasLiveStatus').NodeIdent} ident */
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


onMounted(() => {
  if (!projectStore.projects.length) projectStore.loadProjects()
  const project = projectStore.getProject(queryText(route.params.id))
  if (!project) {
    router.push('/')
    return
  }

  currentProject.value = project
  loadProjectData(project)
  ensureNamespaces(['configTab', 'historyTab', 'variablesTab', 'project', 'common', 'reopening', 'catalog', 'deployment'])
})

onUnmounted(() => {
  if (activeDeploymentId.value) {
    deploymentStore.unsubscribe(activeDeploymentId.value)
    activeDeploymentId.value = null
  }
})

// Canvas undo ring-buffer (C3.11). We snapshot on every node/edge mutation
// so the Undo and Redo controls can restore prior states. Snapshots
// are deep-cloned so future mutations don't retroactively alter old
// entries.
const canvasHistory = useCanvasHistory()
let restoringHistory = false
let placingComponent = false
function cloneSnapshot() {
  return JSON.parse(JSON.stringify({
    nodes: nodes.value || [],
    edges: edges.value || [],
  }))
}

// Local drafts always persist. The preference controls only the existing
// debounced Git working-branch checkpoint, through the same lock/CAS path as Save.
/** @type {ReturnType<typeof setTimeout> | null} */
let autosaveTimer = null
let editorActive = true
function persistLocalGraph() {
  if (currentProject.value) projectStore.updateProject(currentProject.value.id, projectGraph(nodes.value, edges.value))
}
function scheduleAutosave() {
  if (!currentProject.value) return
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    if (!currentProject.value) return
    persistLocalGraph()
    if (editorPreferences.autoSaveToGit && currentProject.value.git && !showRepositoryConnection.value) void manualSave({ quiet: true })
  }, 1500)
}

watch(() => editorAuthoredSignature(nodes.value || [], edges.value || []), scheduleAutosave)
watch(() => editorPreferences.autoSaveToGit, enabled => {
  if (enabled) scheduleAutosave()
})
// Selection, dimensions and dragging are view state, not separate undo steps.
watch(() => {
  const snapshot = cloneSnapshot()
  for (const node of snapshot.nodes) {
    for (const field of ['selected', 'dragging', 'resizing', 'dimensions', 'computedPosition', 'positionAbsolute', 'handleBounds', 'initialized', 'events']) delete node[field]
  }
  for (const edge of snapshot.edges) delete edge.selected
  return editorAuthoredSignature(snapshot.nodes, snapshot.edges)
}, () => {
  if (currentProject.value && !restoringHistory && !placingComponent) canvasHistory.push(cloneSnapshot())
})

function finishComponentPlacement() {
  nextTick(() => {
    if (editorActive) canvasHistory.push(cloneSnapshot())
    placingComponent = false
  })
}

function undoCanvas() {
  const snapshot = canvasHistory.undo()
  if (snapshot) applyCanvasSnapshot(snapshot)
}
function redoCanvas() {
  const snapshot = canvasHistory.redo()
  if (snapshot) applyCanvasSnapshot(snapshot)
}

/** @param {{ nodes: import('@vue-flow/core').Node[]; edges: import('@vue-flow/core').Edge[] }} snapshot */
function applyCanvasSnapshot(snapshot) {
  restoringHistory = true
  // Applying a snapshot writes back via loadProjectData so selection +
  // VueFlow state stay in sync with the restored graph.
  loadProjectData({ ...currentProject.value, ...JSON.parse(JSON.stringify(snapshot)) })
  nextTick(() => { restoringHistory = false })
}

onBeforeUnmount(() => {
  // Capture this project's graph and Git write before another editor mounts.
  const pending = autosaveTimer !== null
  const checkpoint = pending && editorPreferences.autoSaveToGit && currentProject.value?.git && !showRepositoryConnection.value
  const finalSave = checkpoint ? manualSave({ quiet: true }) : Promise.resolve()
  if (pending && !checkpoint) {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer)
    autosaveTimer = null
    try { persistLocalGraph() }
    catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error', 6000) }
  }
  editorActive = false
  void finalSave.finally(() => gitSync.releaseEditor?.())
})

onUnmounted(() => {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
})

function currentPushArgs() {
  const project = currentProject.value
  if (!project) return null
  const generated = project?.scenario ? emitConcreteScenario({
    scenario: project.scenario, ...projectGraph(),
    files: project.files, attachments: project.attachments,
    baseDoc: project.baseDoc, overlay: project.overlay,
    generatedPaths: project.scenario_generated_paths || [],
  }) : null
  return buildPushArgs(generated ? { ...project, files: generated.files } : project, liveNodes.value, liveEdges.value,
    `Save ${currentProject.value?.name || 'project'}`)
}

/** @param {{ commit_sha: string; branch: string; binding?: import('@/composables/useProjectGitSync').ProjectGitBinding; targets?: import('@/composables/useProjectGitSync').ProjectPublishResult[] }} result */
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

/** @param {Awaited<ReturnType<typeof gitSync.publishFilesToTargets>>} result */
function recordPublicationCheckpoint(result) {
  if (gitBindingIdentity(currentProject.value?.git) !== publicationBinding.value) {
    gitSaveError.value = 'The repository connection changed during publication. Results belong to the previous reviewed destination; this project was not rebound.'
    return
  }
  recordCheckpoint(result)
  publicationBinding.value = gitBindingIdentity(currentProject.value?.git)
}

/** @param {import('@/composables/useProjectGitSync').ProjectPublishResult} result */
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
  const originalBinding = gitBindingIdentity(project.git)
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
  projectStore.updateProject(project.id, projectGraph())
  gitSaving.value += 1
  gitSaveError.value = ''
  try {
    if (quiet && gitLockBlocked.value) return null
    const args = currentPushArgs()
    if (!args) return null
    if (project.scenario) projectStore.updateProject(project.id, { files: args.files })
    const result = await gitSync.pushToGit(args)
    if (gitBindingIdentity(project.git) !== originalBinding) throw new Error('Git connection changed while saving. The previous repository result was retained remotely; this project binding was not changed.')
    recordCheckpoint(result, project)
    if (!quiet) showToast(translate('project.git.saved', { branch: result.branch, sha: result.commit_sha.slice(0, 7) }), 'success')
    return result
  } catch (error) {
    gitSaveError.value = error instanceof Error ? error.message : String(error)
    if (!quiet) showToast(translate('project.git.failed', { error: gitSaveError.value }), 'error', 6000)
    return null
  } finally {
    gitSaving.value -= 1
  }
}

/** @param {import('@/composables/useProjectGitSync').ProjectGitBinding | undefined} git */
function gitBindingIdentity(git) {
  if (!git) return ''
  return JSON.stringify([git?.source_id, git?.provider, git?.base_url, git?.repo_owner, git?.repo_name,
    git?.branch || 'main', git?.working_branch || `range42-ui/${encodeURIComponent(currentProject.value?.id || '').replace(/\./g, '%2E')}`, git?.subdir || ''])
}
watch(() => gitBindingIdentity(currentProject.value?.git), (next, previous) => {
  if (previous && previous !== next) void gitSync.releaseEditor?.()
})

async function recoverExpiredGitLock() {
  try { await gitSync.recoverExpired(); gitSaveError.value = '' }
  catch (error) { gitSaveError.value = error instanceof Error ? error.message : String(error) }
}

async function recoverGitBranch() {
  const project = currentProject.value
  if (!project || gitSaving.value) return
  try {
    const git = prepareEditorBranchRecovery(project)
    projectStore.updateProject(project.id, projectGraph())
    await gitSync.releaseEditor()
    projectStore.updateProject(project.id, { git })
    await nextTick()
    await manualSave()
  } catch (error) { gitSaveError.value = error instanceof Error ? error.message : String(error) }
}

function openPublishTargets() {
  try {
    const args = currentPushArgs()
    if (!args) return
    publicationFiles.value = buildProjectFiles(args)
    publicationRevision.value = args.expectedRevision || ''
    publicationBinding.value = gitBindingIdentity(currentProject.value?.git)
    showPublishTargets.value = true
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error', 6000) }
}

/** @param {Parameters<typeof reviewedScenarioUpdates>[1]} result */
function applyScenario(result) {
  if (!currentProject.value) return
  try {
    projectStore.updateProject(currentProject.value.id, reviewedScenarioUpdates(currentProject.value, result, liveNodes.value, liveEdges.value))
    showScenarioAuthoring.value = false
    void manualSave()
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error', 8000) }
}

function openScenarioContent(target = '') {
  scenarioContentTarget.value = typeof target === 'string' ? target : ''
  showScenarioAuthoring.value = true
}

function openRepositoryConnection() {
  if (gitSaving.value > 0) return
  if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null }
  showRepositoryConnection.value = true
}

/** @param {import('@/composables/useProjectGitSync').ProjectGitBinding} binding */
function connectProjectRepository(binding) {
  if (!currentProject.value || gitSaving.value > 0) return
  /** @param {import('@/composables/useProjectGitSync').ProjectGitBinding | undefined} git */
  const identity = git => JSON.stringify([git?.source_id, git?.provider, git?.base_url,
    git?.repo_owner, git?.repo_name, git?.branch || 'main', git?.subdir || ''])
  const changed = identity(binding) !== identity(currentProject.value.git)
  projectStore.updateProject(currentProject.value.id, {
    git: binding, ...(changed ? { head_sha: '', project_sha: '' } : {}),
  })
  if (changed) registeredProjectId.value = ''
  showRepositoryConnection.value = false
}

/** @param {import('@/composables/useProjectGitSync').ProjectPublishTarget[]} targets */
function updatePublicationTargets(targets) {
  if (!currentProject.value?.git) return
  currentProject.value.git = { ...currentProject.value.git, publish_targets: targets }
  projectStore.updateProject(currentProject.value.id, { git: currentProject.value.git })
}

/** @type {number | null} */
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

  /** @param {number} now */
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

/** @param {import('@vue-flow/core').NodeMouseEvent} event */
const handleNodeClick = (event) => {
  onNodeClick(event)
  showConfigPanel.value = !!selectedNode.value
  if (selectedNode.value) router.replace({ query: { ...route.query, node: selectedNode.value.id } })
}

const closeConfigPanel = () => {
  showConfigPanel.value = false
  selectedNode.value = null
  const query = { ...route.query }
  delete query.node
  router.replace({ query })
}

// Node-card "Apply" strip → open that node's ConfigPanel and surface the apply dialog.
/** @param {{ id: string }} slotProps */
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
const mobileSidebarOpen = ref(false)
function toggleMobileSidebar() { mobileSidebarOpen.value = !mobileSidebarOpen.value }
function closeMobileSidebar() { mobileSidebarOpen.value = false }

/** @param {string} type */
async function handleAddComponent(type) {
  closeMobileSidebar()
  await router.push({ query: { ...route.query, tab: 'canvas' } })
  await nextTick()
  if (canvasHistory.size() === 0) canvasHistory.push(cloneSnapshot())
  placingComponent = true
  const nodeId = addComponent(type, finishComponentPlacement)
  if (!nodeId) placingComponent = false
  if (nodeId) await router.push({ query: { ...route.query, tab: 'canvas', node: nodeId } })
}

/** @type {Partial<Record<string, 'left' | 'right' | 'up' | 'down'>>} */
const ARROW_DIRS = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
}

/** @param {KeyboardEvent} event */
const handleCanvasKeydown = (event) => {
  const target = event.target
  if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable))) {
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
/** @param {import('@vue-flow/core').EdgeMouseEvent} event */
const handleEdgeClick = (event) => {
  onEdgeClick(event)
  showConfigPanel.value = false // Close node config when edge is selected
}

const showEdgeConfig = computed(() => !!selectedEdge.value?.data)

// Get source and target nodes for the selected edge
const edgeSourceNode = computed(() => {
  if (!selectedEdge.value) return null
  const edge = selectedEdge.value
  const allNodes = flowGetNodes.value || nodes.value
  return allNodes.find(n => n.id === edge.source)
})

const edgeTargetNode = computed(() => {
  if (!selectedEdge.value) return null
  const edge = selectedEdge.value
  const allNodes = flowGetNodes.value || nodes.value
  return allNodes.find(n => n.id === edge.target)
})

/** @param {string} edgeId @param {Record<string, unknown>} updates */
const handleEdgeUpdate = (edgeId, updates) => {
  updateEdgeData(edgeId, updates)
}

const handleCloseEdgeConfig = () => {
  closeEdgeConfig()
}

/** @param {string} nodeId */
const handleDeleteNode = (nodeId) => {
  // Remove from controlled nodes ref (VueFlow controlled mode)
  nodes.value = nodes.value.filter(n => n.id !== nodeId)
  // Also remove any edges connected to this node
  edges.value = edges.value.filter(e => e.source !== nodeId && e.target !== nodeId)
  closeConfigPanel()
}

/** @param {DragEvent} event */
const handleDrop = (event) => {
  if (canvasHistory.size() === 0) canvasHistory.push(cloneSnapshot())
  placingComponent = true
  if (!onDrop(event, finishComponentPlacement)) placingComponent = false
}

/** @param {DragEvent} event */
const handleDragOver = (event) => {
  event.preventDefault()
  onDragOver(event)
}

/** @param {DragEvent} event */
const handleDragLeave = (event) => {
  onDragLeave(event)
}

/** @type {HTMLElement | null} */
let proxmoxSettingsOpener = null
/** @param {MouseEvent} [event] */
const openProxmoxSettings = (event) => {
  const opener = event?.currentTarget
  proxmoxSettingsOpener = opener instanceof HTMLElement
    ? opener.closest('details')?.querySelector('summary') || opener : null
  showProxmoxSettings.value = true
}

const closeProxmoxSettings = () => {
  if (!showProxmoxSettings.value) return
  showProxmoxSettings.value = false
  nextTick(() => { if (proxmoxSettingsOpener?.isConnected) proxmoxSettingsOpener.focus() })
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
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error', 6000) }
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
// URL state supports direct entry, reload and browser Back/Forward.
// Canvas and the cached Config editor retain their local buffers across tabs.
const TABS = ['canvas', 'config', 'variables', 'history', 'settings']
const tab = computed(() => {
  const q = route.query.tab
  const v = Array.isArray(q) ? q[0] : q
  return TABS.includes(String(v)) ? String(v) : 'canvas'
})

/** @param {string} next */
function setTab(next) {
  if (!TABS.includes(next)) return
  if (route.query.tab === next) return
  return router.push({ query: { ...route.query, tab: next } })
}

/** @param {KeyboardEvent} event @param {string} current */
async function handleTabKeydown(event, current) {
  const index = TABS.indexOf(current)
  const next = event.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length]
    : event.key === 'ArrowLeft' ? TABS[(index + TABS.length - 1) % TABS.length]
      : event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS.at(-1) : null
  if (!next) return
  event.preventDefault()
  const tablist = event.currentTarget instanceof Element ? event.currentTarget.closest('[role=tablist]') : null
  await setTab(next)
  await nextTick()
  const button = tablist?.querySelector(`[data-testid="project-tab-${next}"]`)
  if (button instanceof HTMLElement) button.focus()
}

/** @param {unknown} value */
function queryText(value) {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}
const selectedFilePath = computed(() => queryText(route.query.file))
/** @param {string} path */
function selectConfigFile(path) {
  if (selectedFilePath.value !== path) router.replace({ query: { ...route.query, file: path } })
}
watch(() => [currentProject.value?.id, route.query.node], () => {
  const id = queryText(route.query.node)
  selectedNode.value = (liveNodes.value || []).find(node => node.id === id) || null
  showConfigPanel.value = !!selectedNode.value
}, { flush: 'post' })

function openCatalog() {
  if (!currentProject.value) return
  try {
    projectStore.updateProject(currentProject.value.id, projectGraph())
    // This action preserves the local draft. Leaving the editor must not turn
    // the pending debounce into an unrelated Git write.
    if (autosaveTimer !== null) clearTimeout(autosaveTimer)
    autosaveTimer = null
    router.push({ path: '/catalog', query: { project: currentProject.value.id,
      ...(selectedNode.value ? { node: selectedNode.value.id } : {}) } })
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error', 6000) }
}

const settingsName = ref('')
const settingsError = ref('')
watch(() => currentProject.value?.name, name => { settingsName.value = name || '' }, { immediate: true })
function saveProjectSettings() {
  if (!currentProject.value) return
  const name = settingsName.value.trim()
  if (!name) { settingsError.value = translate('project.settings.nameRequired'); return }
  try {
    projectStore.updateProject(currentProject.value.id, { name })
    settingsError.value = ''
    scheduleAutosave()
    showToast(translate('project.settings.saved'), 'success')
  } catch (error) { settingsError.value = error instanceof Error ? error.message : String(error) }
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

const configOverlayFs = computed(() => {
  const ownerId = currentProject.value?.id
  return createMemoryFs({
    files: overlayFiles.value || {},
    onChange: (files) => {
      if (!ownerId || !editorActive || currentProject.value?.id !== ownerId) {
        throw new Error(translate('project.config.closed'))
      }
      projectStore.updateProject(ownerId, { files: { ...files } })
      scheduleAutosave()
    },
  })
})
const configBaseFs = computed(() => createMemoryFs({ files: baseFiles.value }))

function handleConfigSave() {
  void manualSave()
}

/** @param {import('@/overlay/serialize').CanvasAttachment[]} next */
function handleAttachmentsUpdate(next) {
  if (!currentProject.value) return
  currentProject.value.attachments = next
  projectStore.updateProject(currentProject.value.id, {
    attachments: next,
  })
  scheduleAutosave()
}

// Read the same source/credential binding used for project saves. Legacy
// gitSource projects keep their previous locator until explicitly reconnected.
const historyState = computed(() => {
  if (tab.value !== 'history') return {}
  const project = currentProject.value
  const binding = project?.git
  try {
    if (binding) {
      const prefix = binding.subdir ? binding.subdir.replace(/\/+$/, '') + '/' : ''
      return { provider: providerForBinding(binding), locator: {
        owner: binding.repo_owner, repo: binding.repo_name,
        path: `${prefix}topology.json`, ref: binding.working_branch || binding.branch || 'main',
      } }
    }
    const src = project?.gitSource
    if (!src?.provider || !src.owner || !src.repo) return {}
    const provider = src.provider === 'github' ? (() => {
      const gh = getGitProvider('github')
      const listCommits = gh.listCommits
      if (!listCommits) throw new Error('This legacy Git provider cannot list history. Reconnect the project repository.')
      /** @type {Pick<import('@/services/git/types').GitProviderV1, 'listCommits' | 'getFile'>} */
      const history = { listCommits: opts => listCommits.call(gh, opts), getFile: async opts => ({
        content: await gh.getFile(opts.owner, opts.repo, opts.path, opts.ref), sha: '',
      }) }
      return history
    })() : getV1Provider(src.provider, { baseUrl: src.baseUrl, token: src.token ?? null })
    return { provider, locator: { owner: src.owner, repo: src.repo, path: src.path || 'range42.yaml', ref: src.ref || 'main' } }
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
})
const historyProvider = computed(() => historyState.value.provider)
const historyLocator = computed(() => historyState.value.locator)

// VariablesTab wiring (C3.10). The effective env[] comes from the catalog
// base doc embedded in the project (`project.baseDoc`) — missing today for
// legacy projects, so we fall back to an empty list. Overrides are
// persisted on `project.overlay.param_overrides.env`.
const variablesBase = computed(() => currentProject.value?.baseDoc || { env: [] })
const variablesOverlay = computed(() => currentProject.value?.overlay || {})

/** @param {Record<string, unknown>} nextOverlay */
function handleOverlayUpdate(nextOverlay) {
  if (!currentProject.value) return
  currentProject.value.overlay = nextOverlay
  projectStore.updateProject(currentProject.value.id, {
    overlay: nextOverlay,
  })
  scheduleAutosave()
}

// Import config: resolved from per-project settings at setup level
const importApiConfig = useApiConfig(projectId, { autoSync: true })

// Provide API config to child components (ConfigPanel, etc.)
provide('apiConfig', importApiConfig)

watch(() => importApiConfig.isReady.value, ready => { if (ready) importApiConfig.configure() }, { immediate: true })
const observedGuestStatus = useObservedGuestStatus({
  nodes: () => liveNodes.value,
  projectId: () => projectId.value,
  enabled: () => importApiConfig.isReady.value,
  target: () => ({ node: importApiConfig.node.value }),
  apply: (node, patch) => updateNodeData(node.id, patch),
})

const handleOpenImport = () => {
  // Ensure the API client has the correct base URL from per-project settings
  importApiConfig.configure()
  showImportModal.value = true
}

/** @param {{ nodes?: unknown[]; edges?: unknown[] }} result */
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
  <div class="h-full min-h-0">
  <div class="h-full min-h-0 bg-base-100 flex" v-if="currentProject">
    <!-- Sidebar (desktop ≥lg) -->
    <div class="hidden lg:block shrink-0">
    <Sidebar
      :project="currentProject"
      @addComponent="handleAddComponent"
      @openExport="showExportModal = true"
      @openDeploy="handleOpenDeploy"
      @openValidate="handleOpenValidate"
      @openInventory="openCatalog"
      @openTemplates="showTemplateBrowser = true"
      @openImport="handleOpenImport"
    />
    </div>

    <SidebarDrawer :open="mobileSidebarOpen" :title="translate('sidebar.projectTools')" :close-label="translate('sidebar.closeTools')"
      id="mobile-drawer" data-testid="mobile-drawer" @close="closeMobileSidebar">
      <Sidebar :project="currentProject" @addComponent="handleAddComponent"
        @openExport="showExportModal = true; closeMobileSidebar()"
        @openDeploy="handleOpenDeploy(); closeMobileSidebar()"
        @openValidate="handleOpenValidate(); closeMobileSidebar()"
        @openInventory="openCatalog(); closeMobileSidebar()"
        @openTemplates="showTemplateBrowser = true; closeMobileSidebar()"
        @openImport="handleOpenImport(); closeMobileSidebar()" />
    </SidebarDrawer>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Top Bar -->
      <header class="min-h-14 px-3 py-2 sm:px-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-base-300 bg-base-100 shrink-0">
        <div class="flex min-w-0 items-center gap-3">
          <!-- Mobile menu toggle -->
          <button
            type="button"
            class="btn btn-ghost btn-sm gap-2 lg:hidden"
            :aria-expanded="mobileSidebarOpen ? 'true' : 'false'"
            aria-controls="mobile-drawer"
            :aria-label="translate('sidebar.projectTools')"
            data-testid="mobile-drawer-toggle"
            @click="toggleMobileSidebar"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
            <span>{{ translate('sidebar.components') }}</span>
          </button>
          
          <!-- Project name -->
          <h1 class="font-semibold truncate max-w-[200px]">{{ currentProject.name }}</h1>
        </div>

        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <!-- Save button -->
          <button type="button" class="btn btn-ghost btn-sm" data-testid="project-repository" :disabled="gitSaving > 0" @click="openRepositoryConnection">Repository</button>
          <button class="btn btn-ghost btn-sm gap-2" :disabled="gitSaving > 0" @click="manualSave()" title="Save project" aria-label="Save project">
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
          <details ref="projectActionsMenu" class="dropdown dropdown-end" :open="projectActionsOpen" @toggle="syncProjectActions" @keydown.esc.stop.prevent="closeProjectActions">
            <summary role="button" class="btn btn-ghost btn-sm btn-square" :aria-label="translate('sidebar.projectActions')" :aria-expanded="projectActionsOpen">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              </svg>
            </summary>
            <ul class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-xl w-56 border border-base-300" @click="closeProjectActions">
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
              <li class="divider my-1" role="separator"></li>
              <li>
                <button class="gap-3" @click="showExportModal = true">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  Export
                </button>
              </li>
              <li class="divider my-1" role="separator"></li>
              <li>
                <button class="gap-3 text-error" @click="showDeleteProjectModal = true">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                  </svg>
                  Delete Project
                </button>
              </li>
            </ul>
          </details>
        </div>

        <!-- Canvas and catalog actions -->
        <div class="project-toolbar flex w-full min-w-0 flex-wrap items-center gap-1.5 border-t border-base-300 pt-2">
          <button type="button" class="btn btn-ghost btn-sm" @click="showCommandPalette = true">{{ translate('sidebar.searchProject') }}</button>
          <button v-if="tab === 'canvas'" type="button" class="btn btn-ghost btn-sm" :disabled="!canvasHistory.canUndo.value" @click="undoCanvas">{{ translate('sidebar.undo') }}</button>
          <button v-if="tab === 'canvas'" type="button" class="btn btn-ghost btn-sm" :disabled="!canvasHistory.canRedo.value" @click="redoCanvas">{{ translate('sidebar.redo') }}</button>
          <!-- Organize layout button -->
          <button class="btn btn-ghost btn-sm gap-1" @click="handleAutoLayout" title="Organize topology layout" aria-label="Organize topology layout">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path>
            </svg>
            <span class="hidden sm:inline">Organize</span>
          </button>

          <button type="button" class="btn btn-outline btn-sm" data-testid="project-add-catalog" @click="openCatalog">{{ translate('project.addCatalog') }}</button>
          <button type="button" class="btn btn-outline btn-sm" data-testid="project-scenario" @click="openScenarioContent()">Scenario</button>

        </div>
      </header>


      <p v-if="route.query.action === 'deploy'" role="status" class="px-3 py-2 text-sm bg-info/10" data-testid="project-deployment-review">
        {{ translate('deployment.deploy.reviewFromHome') }}
      </p>
      <div v-if="currentProject?.git" class="px-3 py-1 text-xs text-base-content/70" data-testid="project-git-status">
        <span v-if="gitSaving">{{ translate('project.git.saving') }}</span>
        <span v-else-if="gitSaveError" role="alert" class="text-error">{{ gitSaveError }}</span>
        <span v-else-if="currentProject.head_sha">{{ translate('project.git.saved', { branch: currentProject.git.working_branch || '—', sha: currentProject.head_sha.slice(0, 7) }) }}</span>
      </div>
      <section v-if="currentProject?.git && gitLockBlocked" role="alert" class="px-3 py-3 bg-warning/10 text-sm space-y-2" data-testid="git-lock-recovery">
        <p>{{ gitLockError }}</p>
        <p>Local edits are kept. Reopen a remote copy from Home to compare changes, or save this draft on a separate branch. Expired-lock recovery checks ownership again and never merges remote changes automatically.</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-sm btn-outline" data-testid="git-recover-expired" :disabled="gitSaving > 0" @click="recoverExpiredGitLock">Recover expired lock</button>
          <button type="button" class="btn btn-sm btn-outline" data-testid="git-recover-branch" :disabled="gitSaving > 0" @click="recoverGitBranch">Save local draft on new branch</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="router.push('/')">Home / open remote copy</button>
        </div>
      </section>
      <div v-if="currentProject?.catalogRef" class="px-3 py-2 text-xs text-base-content/70 break-all" data-testid="project-catalog-origin">
        <p>{{ translate('catalog.handoff.origin') }}: {{ currentProject.catalogRef.repo_owner || currentProject.catalogRef.source_id }}/{{ currentProject.catalogRef.repo_name || '' }} · {{ currentProject.catalogRef.path }} · {{ currentProject.catalogRef.sha || '—' }}</p>
        <p v-if="currentProject.catalogRef.kind === 'ansible_role'">{{ translate('catalog.handoff.role_editor') }}</p>
      </div>
      <div v-if="currentProject?.git_opened" class="px-3 py-1 text-xs text-base-content/70 break-all" data-testid="project-opened-revision">
        <p>{{ translate('reopening.opened_revision', { branch: currentProject.git_opened.branch, sha: currentProject.git_opened.commit_sha }) }}</p>
        <p v-if="currentProject.git_opened.mode === 'files' && !currentProject.scenario">{{ translate('reopening.files_notice') }}</p>
      </div>

      <div v-if="importApiConfig.isReady.value" class="px-3 py-1 flex flex-wrap gap-2 items-center text-xs">
        <button type="button" class="btn btn-ghost btn-xs" :disabled="observedGuestStatus.isRefreshing.value" @click="observedGuestStatus.refresh">Refresh guest status</button>
        <span v-if="observedGuestStatus.error.value" role="status">{{ observedGuestStatus.error.value }}</span>
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
          :tabindex="tab === t ? 0 : -1"
          :data-testid="`project-tab-${t}`"
          @keydown="handleTabKeydown($event, t)"
          @click="setTab(t)"
        >
          {{ translate(`project.tabs.${t}`) }}
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
          :snap-to-grid="editorPreferences.snapToGrid"
          :snap-grid="editorSnapGrid"
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
          <Background :gap="editorPreferences.gridSize" />
          <Controls position="bottom-left">
            <!-- Public icon slots name the original buttons, retaining VueFlow's handlers and disabled states. -->
            <template #icon-zoom-in>
              <span class="sr-only">Zoom in</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 3h2v8h8v2h-8v8h-2v-8H3v-2h8z" /></svg>
            </template>
            <template #icon-zoom-out>
              <span class="sr-only">Zoom out</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 11h18v2H3z" /></svg>
            </template>
            <template #icon-fit-view>
              <span class="sr-only">Fit view</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3h6v2H5v4H3zm12 0h6v6h-2V5h-4zM3 15h2v4h4v2H3zm16 0h2v6h-6v-2h4z" /></svg>
            </template>
            <template #icon-unlock>
              <span class="sr-only">Lock node interaction</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V7a5 5 0 0 1 9.58-2H14.9A3 3 0 0 0 9 7v3h9v11H6V10zm5 4a1 1 0 0 0-1 1v3h2v-3a1 1 0 0 0-1-1z" /></svg>
            </template>
            <template #icon-lock>
              <span class="sr-only">Unlock node interaction</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V7a5 5 0 0 1 10 0v3h1v11H6V10zm2 0h6V7a3 3 0 0 0-6 0zm3 4a1 1 0 0 0-1 1v3h2v-3a1 1 0 0 0-1-1z" /></svg>
            </template>
          </Controls>
          <MiniMap position="bottom-right" />

          <!-- Organization -->
          <template #node-group="props">
            <GroupNode
              v-bind="props"
              @update:kind="updateNodeStatus(props.id, { kind: $event })"
              @update:scope="updateNodeStatus(props.id, { kind: $event })"
              @update:expanded="updateNodeStatus(props.id, { _expanded_preview: $event })"
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
        <KeepAlive :max="1">
          <ConfigTab
            :key="currentProject.id"
            v-if="currentProject && tab === 'config'"
            :path="selectedFilePath"
            :overlay-fs="configOverlayFs"
            :base-fs="configBaseFs"
            @select="selectConfigFile"
            :attachments="attachmentsRef"
            :nodes="liveNodes"
            @update:attachments="handleAttachmentsUpdate"
            @open-content="openScenarioContent"
            @save="handleConfigSave"
          />
        </KeepAlive>
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
      <div v-show="tab === 'history'" class="flex-1 min-h-0 overflow-auto" data-testid="tab-history">
        <p v-if="historyLocator" class="p-2 text-sm text-base-content/70 break-all" data-testid="project-history-path">{{ translate('project.history.file', { path: historyLocator.path, ref: historyLocator.ref }) }}</p>
        <HistoryTab
          v-if="historyProvider && historyLocator"
          :provider="historyProvider"
          :locator="historyLocator"
        />
        <div v-else-if="historyState.error" role="alert" class="p-4 text-sm text-error">{{ historyState.error }}</div>
        <div v-else class="p-4 text-sm text-base-content/60">
          {{ $t ? $t('historyTab.noSource') : 'Link this project to a git source to see its history.' }}
        </div>
      </div>

      <div v-show="tab === 'settings'" class="flex-1 overflow-y-auto p-4 space-y-5" data-testid="tab-settings">
        <form class="max-w-xl space-y-3" data-testid="project-settings-form" @submit.prevent="saveProjectSettings">
          <h2 class="font-semibold">{{ translate('project.settings.title') }}</h2>
          <p class="text-sm text-base-content/70 break-all">{{ translate('project.settings.identity') }}: {{ currentProject.id }}</p>
          <label for="project-settings-name" class="block text-sm">{{ translate('project.settings.name') }}</label>
          <input id="project-settings-name" v-model="settingsName" name="project_name" autocomplete="off" maxlength="120" required class="input input-bordered w-full" data-testid="project-settings-name" />
          <p v-if="settingsError" role="alert" class="text-sm text-error">{{ settingsError }}</p>
          <button type="submit" class="btn btn-primary btn-sm">{{ translate('project.settings.save') }}</button>
        </form>
        <details v-if="currentProject.catalogImports?.length" class="max-w-xl space-y-2" data-testid="project-catalog-imports">
          <summary class="cursor-pointer font-semibold">{{ translate('project.settings.catalogImports', { count: currentProject.catalogImports.length }) }}</summary>
          <ul class="space-y-3 pt-2 text-sm">
            <li v-for="item in currentProject.catalogImports" :key="item.id" class="space-y-1 rounded border border-base-300 p-3" data-testid="project-catalog-import">
              <p class="break-all">{{ item.origin.kind }} · {{ item.origin.path }}</p>
              <p class="break-all text-base-content/70">{{ translate('project.settings.sourceRevision') }}: {{ item.origin.sha }}</p>
              <p>{{ translate('project.settings.importCounts', { nodes: item.node_ids.length, content: item.content_ids.length, attachments: item.attachment_ids.length }) }}</p>
            </li>
          </ul>
        </details>
        <section class="max-w-xl space-y-2">
          <h2 class="font-semibold">{{ translate('project.settings.repository') }}</h2>
          <p class="text-sm break-all">{{ currentProject.git ? `${currentProject.git.repo_owner}/${currentProject.git.repo_name}` : translate('project.settings.localOnly') }}</p>
          <p v-if="currentProject.git" class="text-sm break-all">{{ translate('project.settings.branch') }}: {{ currentProject.git.working_branch || translate('project.settings.notSaved') }}</p>
          <button type="button" class="btn btn-outline btn-sm" data-testid="project-settings-repository" :disabled="gitSaving > 0" @click="openRepositoryConnection">{{ translate('project.settings.configureRepository') }}</button>
        </section>
        <section class="max-w-xl space-y-2">
          <h2 class="font-semibold">{{ translate('project.settings.target') }}</h2>
          <p class="text-sm break-all">{{ importApiConfig.node.value || translate('project.settings.noTarget') }}</p>
          <button type="button" class="btn btn-outline btn-sm" data-testid="project-settings-target" @click="openProxmoxSettings">{{ translate('project.settings.configureTarget') }}</button>
        </section>
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
      @open-content="openScenarioContent"
    />
    
    <!-- Edge Config Panel -->
    <div v-if="showEdgeConfig && selectedEdge" class="fixed right-4 top-20 z-50">
      <EdgeConfigPanel 
        :edge="selectedEdge" 
        :source-node="edgeSourceNode || undefined"
        :target-node="edgeTargetNode || undefined"
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
      :initial-target="scenarioContentTarget"
      @close="showScenarioAuthoring = false" @generated="applyScenario" />

    <PublishTargetsModal
      v-if="showPublishTargets && currentProject?.git"
      :open="showPublishTargets" :project-id="currentProject.id" :binding="currentProject.git"
      :files="publicationFiles" :expected-revision="publicationRevision" :message="`Publish ${currentProject.name}`"
      :initial-targets="currentProject.git.publish_targets || []"
      @close="showPublishTargets = false" @published="recordPublicationCheckpoint" @reviewed="recordPublicationReview"
      @update:targets="updatePublicationTargets"
    />

    <!-- Plan C §C4.6 — DeployForm with inline preflight + SHA-pin -->
    <DeployForm
      v-if="showDeployForm && currentProject"
      :visible="showDeployForm"
      :project-id="registeredProjectId || currentProject.id"
      :local-project-id="currentProject.id"
      :project-name="currentProject.name"
      :initial-scenario-label="currentProject.scenario?.label || ''"
      :allocation="currentProject.scenario?.allocation"
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


    <!-- Project search — body-teleported by the component itself -->
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

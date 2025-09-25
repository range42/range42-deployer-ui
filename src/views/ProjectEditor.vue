<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'

import Sidebar from '../components/Sidebar.vue'

import InfraNodeVm from '../components/nodes/InfraNodeVm.vue'
import InfraNodeNetwork from '../components/nodes/InfraNodeNetwork.vue'
import InfraNodeDocker from '../components/nodes/InfraNodeDocker.vue'
import InfraNodeRouter from '../components/nodes/InfraNodeRouter.vue'
import InfraNodeSwitch from '../components/nodes/InfraNodeSwitch.vue'
import InfraNodeFirewall from '../components/nodes/InfraNodeFirewall.vue'
import InfraNodeDns from '../components/nodes/InfraNodeDns.vue'
import InfraNodeDhcp from '../components/nodes/InfraNodeDhcp.vue'
import InfraNodeLoadBalancer from '../components/nodes/InfraNodeLoadBalancer.vue'
import ConfigPanel from '../components/ConfigPanel.vue'
import ExportModal from '../components/ExportModal.vue'

import { useInfraBuilder } from '../composables/useInfraBuilder'
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
  onConnect,
  onNodeClick,
  updateNodeStatus,
  onNodesChange,
  onEdgesChange,
  loadProjectData
} = useInfraBuilder()

const { getNodes: flowGetNodes, getEdges: flowGetEdges } = useVueFlow()

const dragAndDropComposable = useDragAndDrop()
const { onDragOver, onDrop, onDragLeave, isDragOver } = dragAndDropComposable || {}

const showConfigPanel = ref(false)
const showExportModal = ref(false)
const currentProject = ref(null)

const liveNodes = computed(() => (flowGetNodes?.value && flowGetNodes.value.length ? flowGetNodes.value : nodes.value) || [])
const liveEdges = computed(() => (flowGetEdges?.value && flowGetEdges.value.length ? flowGetEdges.value : edges.value) || [])


////

const {
  // useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume,
  //
  handleBundleCoreProxmoxConfigureDefault_startVmsVuln,
  handleBundleCoreProxmoxConfigureDefault_stopVmsVuln,
  handleBundleCoreProxmoxConfigureDefault_pauseVmsVuln,
  handleBundleCoreProxmoxConfigureDefault_resumeVmsVuln,
  //
  handleBundleCoreProxmoxConfigureDefault_startVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_stopVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_pauseVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_resumeVmsAdmin,
  //
  handleBundleCoreProxmoxConfigureDefault_startVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_stopVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_pauseVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_resumeVmsStudent,
  //
  current_action: current_action_startStopPauseResumeDefaultVms,
  //
  loading: loading_startStopPauseResumeDefaultVms,
  error: error_startStopPauseResumeDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume()

const {
  //
  // useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms,
  //
  handleBundleCoreProxmoxConfigureDefault_deleteVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_deleteVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_deleteVmsVuln,
  //

  current_action: current_action_deleteDefaultVms, // status variable to block UI during processing and allow us to identify where enable the spinner.
  loading: loading_deleteDefaultVms,
  error: error_deleteDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms()

const {
  //
  // useBundleCoreProxmoxConfigureDefaultVms_createTargetVms,
  //
  handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsAdmin,
  handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsVuln,
  handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsStudent,
  //
  current_action: createVms_current_action, // status variable to block UI during processing and allow us to identify where enable the spinner.
  loading: createVms_loading,
  error: error_createDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVms_createTargetVms()

const {
  //
  // useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms,
  //
  handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotAdmin,
  handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotStudent,
  handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotVuln,
  //
  current_action: current_action_snapshotRevertDefaultVms, // status variable to block UI during processing and allow us to identify where enable the spinner.
  loading: loading_snapshotRevertDefaultVms,
  error: error_snapshotRevertDefaultVms,
} = useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms()

const {
  //
  // useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms,
  //
  handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotAdmin,
  handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotStudent,
  handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotVuln,
  //
  current_action: current_action_snapshotCreateDefaultVms, // status variable to block UI during processing and allow us to identify where enable the spinner.
  loading: loading_snapshotCreateDefaultVms,
  error: error_snapshotCreateDefaultVms,

} = useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms()

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
</script>

<template>
  <div class="h-screen bg-base-100" v-if="currentProject">
    <div class="drawer lg:drawer-open">
      <input id="drawer-toggle" type="checkbox" class="drawer-toggle" />

      <div class="drawer-content flex flex-col h-full">
        <!-- Navbar -->
        <div class="navbar bg-base-200">
          <div class="navbar-start">
            <label for="drawer-toggle" class="btn btn-square btn-ghost lg:hidden">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16">
                </path>
              </svg>
            </label>
            <button class="btn btn-ghost" @click="goBack">
              ← Back
            </button>
          </div>

          <div class="navbar-center">
            <h1 class="text-xl font-bold">{{ currentProject.name }}</h1>
          </div>

          <div class="navbar-end space-x-2">
            <button class="btn btn-sm" @click="manualSave">💾 Save</button>
            <div class="dropdown dropdown-end">
              <label tabindex="0" class="btn btn-ghost">⚙️</label>
              <ul class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
                <li><a @click="showExportModal = true">🧭 Export Topology</a></li>
                <li><a>🔍 Validate Configuration</a></li>
              </ul>
            </div>
          </div>


          <div class="dropdown dropdown-end" :class="{ 'dropdown-open': loading || !!error }">
            <label tabindex="0" class="btn btn-ghost">🛠</label>

            <ul class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-200">

              <!-- ---------------------------------- --------------------------- ---------------------------------- -->
              <!-- ---------------------------------- VULNERABLE VIRTUAL MACHINES ---------------------------------- -->
              <!-- ---------------------------------- --------------------------- ---------------------------------- -->

              <li>
                <details>
                  <summary> ⚡ Vulnerable Virtual Machines (default) </summary>
                  <!-- <ul class="mt-2 space-y-2 items-start text-left"> -->
                  <ul class="mt-1 space-y-1 flex flex-col items-start">
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsVuln()" :disabled="loading">
                        <span v-if="createVms_current_action === 'create'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          📦 {{ createVms_current_action === 'create' ? 'Creating' : 'Create' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_startVmsVuln()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'start'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🟢 {{ current_action_startStopPauseResumeDefaultVms === 'start' ? 'Starting' : 'Start' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_stopVmsVuln()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'stop'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🛑 {{ current_action_startStopPauseResumeDefaultVms === 'stop' ? 'Stopping' : 'Stop' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_pauseVmsVuln()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'pause'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ⏸️ {{ current_action_startStopPauseResumeDefaultVms === 'pause' ? 'Pausing' : 'Pause' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_resumeVmsVuln()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'resume'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ▶️ {{ current_action_startStopPauseResumeDefaultVms === 'resume' ? 'Resuming' : 'Resume' }}
                        </span>
                      </button>
                    </li>
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_deleteVmsVuln()" :disabled="loading">
                        <span v-if="current_action_deleteDefaultVms === 'delete'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🗑️ {{ current_action_deleteDefaultVms === 'delete' ? 'deleting' : 'Delete' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotVuln()"
                        :disabled="loading">
                        <span v-if="current_action_snapshotCreateDefaultVms === 'vm_snapshot_create'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          💾 {{ current_action_snapshotCreateDefaultVms === 'snapshot' ? 'snapshoting' : 'Snapshot' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotVuln()"
                        :disabled="loading">
                        <span v-if="current_action_snapshotRevertDefaultVms === 'vm_snapshot_revert'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ↩️ {{ current_action_snapshotRevertDefaultVms === 'revert' ? 'reverting' : 'Revert' }}
                        </span>
                      </button>
                    </li>


                  </ul>
                </details>
              </li>

              <!-- ---------------------------------- ---------------------- ---------------------------------- -->
              <!-- ---------------------------------- ADMIN VIRTUAL MACHINES ---------------------------------- -->
              <!-- ---------------------------------- ---------------------- ---------------------------------- -->

              <li>
                <details>
                  <summary> ⚡ Admin Virtual Machines (default)</summary>
                  <!-- <ul class="mt-2 space-y-2"> -->
                  <ul class="mt-1 space-y-1 flex flex-col items-start">
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsAdmin()" :disabled="loading">
                        <span v-if="createVms_current_action === 'create'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          📦 {{ createVms_current_action === 'create' ? 'Creating' : 'Create' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_startVmsAdmin()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'start'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🟢 {{ current_action_startStopPauseResumeDefaultVms === 'start' ? 'Starting' : 'Start' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_stopVmsAdmin()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'stop'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🛑 {{ current_action_startStopPauseResumeDefaultVms === 'stop' ? 'Stopping' : 'Stop' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_pauseVmsAdmin()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'pause'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ⏸️ {{ current_action_startStopPauseResumeDefaultVms === 'pause' ? 'Pausing' : 'Pause' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_resumeVmsAdmin()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'resume'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ▶️ {{ current_action_startStopPauseResumeDefaultVms === 'resume' ? 'Resuming' : 'Resume' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_deleteVmsAdmin()" :disabled="loading">
                        <span v-if="current_action_deleteDefaultVms === 'delete'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🗑️ {{ current_action_deleteDefaultVms === 'delete' ? 'deleting' : 'Delete' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotAdmin()"
                        :disabled="loading">
                        <span v-if="current_action_snapshotCreateDefaultVms === 'vm_snapshot_create'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          💾 {{ current_action_snapshotCreateDefaultVms === 'snapshot' ? 'snapshoting' : 'Snapshot' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotAdmin()"
                        :disabled="loading">
                        <span v-if="current_action_snapshotRevertDefaultVms === 'vm_snapshot_revert'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ↩️ {{ current_action_snapshotRevertDefaultVms === 'revert' ? 'reverting' : 'Revert' }}
                        </span>
                      </button>
                    </li>
                  </ul>
                </details>
              </li>

              <!-- ---------------------------------- ------------------------ ---------------------------------- -->
              <!-- ---------------------------------- STUDENT VIRTUAL MACHINES ---------------------------------- -->
              <!-- ---------------------------------- ------------------------ ---------------------------------- -->

              <li>
                <details>
                  <summary> ⚡ Student Virtual Machines (default) </summary>
                  <!-- <ul class="mt-2 space-y-2"> -->
                  <ul class="mt-1 space-y-1 flex flex-col items-start">
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsStudent()"
                        :disabled="loading">
                        <span v-if="createVms_current_action === 'create'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          📦 {{ createVms_current_action === 'create' ? 'Creating' : 'Create' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_startVmsStudent()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'start'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🟢 {{ current_action_startStopPauseResumeDefaultVms === 'start' ? 'Starting' : 'Start' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_stopVmsStudent()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'stop'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🛑 {{ current_action_startStopPauseResumeDefaultVms === 'stop' ? 'Stopping' : 'Stop' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_pauseVmsStudent()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'pause'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ⏸️ {{ current_action_startStopPauseResumeDefaultVms === 'pause' ? 'Pausing' : 'Pause' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_resumeVmsStudent()" :disabled="loading">
                        <span v-if="current_action_startStopPauseResumeDefaultVms === 'resume'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ▶️ {{ current_action_startStopPauseResumeDefaultVms === 'resume' ? 'Resuming' : 'Resume' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_deleteVmsStudent()" :disabled="loading">
                        <span v-if="current_action_deleteDefaultVms === 'delete'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          🗑️ {{ current_action_deleteDefaultVms === 'delete' ? 'deleting' : 'Delete' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotStudent()"
                        :disabled="loading">
                        <span v-if="current_action_snapshotCreateDefaultVms === 'vm_snapshot_create'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          💾 {{ current_action_snapshotCreateDefaultVms === 'vm_snapshot_create' ? 'snapshoting' :
                            'Snapshot' }}
                        </span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotStudent()"
                        :disabled="loading">
                        <span v-if="current_action_snapshotRevertDefaultVms === 'vm_snapshot_revert'"
                          class="loading loading-spinner loading-xs"></span>
                        <span>
                          ↩️ {{ current_action_snapshotRevertDefaultVms === 'vm_snapshot_revert' ? 'reverting' :
                            'Revert' }}
                        </span>
                      </button>
                    </li>
                  </ul>
                </details>
              </li>

              <!-- <p v-if="error" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error }}
              </p> -->

              <p v-if="error_startStopPauseResumeDefaultVms" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error_startStopPauseResumeDefaultVms }}
              </p>

              <p v-if="error_deleteDefaultVms" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error_deleteDefaultVms }}
              </p>

              <p v-if="error_createDefaultVms" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error_createDefaultVms }}
              </p>

              <p v-if="error_snapshotRevertDefaultVms" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error_snapshotRevertDefaultVms }}
              </p>

              <p v-if="error_snapshotCreateDefaultVms" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error_snapshotCreateDefaultVms }}
              </p>

            </ul>
          </div>
        </div>

        <!-- VueFlow Canvas -->
        <div class="flex-1 relative transition-colors duration-200" :class="{ 'bg-primary bg-opacity-5': isDragOver }"
          @drop="handleDrop" @dragover="handleDragOver" @dragleave="handleDragLeave">
          <VueFlow :nodes="nodes" :edges="edges" @connect="onConnect" @node-click="handleNodeClick"
            @nodes-change="onNodesChange" @edges-change="onEdgesChange" fit-view-on-init elevate-edges-on-select
            class="h-full w-full">
            <Background />
            <Controls />
            <MiniMap />

            <!-- Existing Node Templates -->
            <template #node-vm="props">
              <InfraNodeVm v-bind="props" />
            </template>

            <template #node-network="props">
              <InfraNodeNetwork v-bind="props" />
            </template>

            <template #node-docker="props">
              <InfraNodeDocker v-bind="props" />
            </template>

            <!-- Enhanced Network Infrastructure Templates -->
            <template #node-network-segment="props">
              <InfraNodeNetwork v-bind="props" />
            </template>

            <template #node-router="props">
              <InfraNodeRouter v-bind="props" />
            </template>

            <template #node-switch="props">
              <InfraNodeSwitch v-bind="props" />
            </template>

            <template #node-firewall="props">
              <InfraNodeFirewall v-bind="props" />
            </template>

            <template #node-dns="props">
              <InfraNodeDns v-bind="props" />
            </template>

            <template #node-dhcp="props">
              <InfraNodeDhcp v-bind="props" />
            </template>

            <template #node-loadbalancer="props">
              <InfraNodeLoadBalancer v-bind="props" />
            </template>
          </VueFlow>

          <!-- Drop Indicator -->
          <div v-if="isDragOver" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div class="alert alert-info max-w-md">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                class="stroke-current shrink-0 w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span>Drop here to create component or inside a network zone</span>
            </div>
          </div>
        </div>
      </div>

      <div class="drawer-side">
        <label for="drawer-toggle" class="drawer-overlay"></label>
        <Sidebar class="min-h-full" :project="currentProject" @openExport="showExportModal = true" />
      </div>
    </div>

    <ConfigPanel v-if="selectedNode && showConfigPanel" :node="selectedNode" @close="closeConfigPanel"
      @update="updateNodeStatus" />
    <ExportModal :project="currentProject" :visible="showExportModal" :nodes="liveNodes" :edges="liveEdges"
      @close="showExportModal = false" />
  </div>

</template>

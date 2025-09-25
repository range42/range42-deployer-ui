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

import { useBundleCoreProxmoxConfigureDefaultVmsTarget_StartStopPauseResume } from '@/composables/runnerCalls/bundle/core/proxmox/configure/DefaultVms/startStopPauseResumeVms'

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
  // useBundleCoreProxmoxConfigureDefaultVmsTarget_StartStopPauseResume,
  //
  handleBundleCoreProxmoxConfigureDefault_StartVmsVuln,
  handleBundleCoreProxmoxConfigureDefault_StopVmsVuln,
  handleBundleCoreProxmoxConfigureDefault_PauseVmsVuln,
  handleBundleCoreProxmoxConfigureDefault_ResumeVmsVuln,
  //
  handleBundleCoreProxmoxConfigureDefault_StartVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_StopVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_PauseVmsAdmin,
  handleBundleCoreProxmoxConfigureDefault_ResumeVmsAdmin,
  //
  handleBundleCoreProxmoxConfigureDefault_StartVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_StopVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_PauseVmsStudent,
  handleBundleCoreProxmoxConfigureDefault_ResumeVmsStudent,
  current_action,
  loading,
  error
} = useBundleCoreProxmoxConfigureDefaultVmsTarget_StartStopPauseResume()

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
                  <summary> ⚡ Vulnerable Virtual Machines </summary>
                  <ul class="mt-2 space-y-2">
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_StartVmsVuln()" :disabled="loading">
                        <span v-if="current_action === 'start'" class="loading loading-spinner loading-xs"></span>
                        <span>🟢 {{ current_action === 'start' ? 'Starting' : 'Start' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_StopVmsVuln()" :disabled="loading">
                        <span v-if="current_action === 'stop'" class="loading loading-spinner loading-xs"></span>
                        <span>🛑 {{ current_action === 'stop' ? 'Stopping' : 'Stop' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_PauseVmsVuln()" :disabled="loading">
                        <span v-if="current_action === 'pause'" class="loading loading-spinner loading-xs"></span>
                        <span>⏸️ {{ current_action === 'pause' ? 'Pausing' : 'Pause' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_ResumeVmsVuln()" :disabled="loading">
                        <span v-if="current_action === 'resume'" class="loading loading-spinner loading-xs"></span>
                        <span>▶️ {{ current_action === 'resume' ? 'Resuming' : 'Resume' }}</span>
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
                  <summary> ⚡ Admin Virtual Machines </summary>
                  <ul class="mt-2 space-y-2">
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_StartVmsAdmin()" :disabled="loading">
                        <span v-if="current_action === 'start'" class="loading loading-spinner loading-xs"></span>
                        <span>🟢 {{ current_action === 'start' ? 'Starting' : 'Start' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_StopVmsAdmin()" :disabled="loading">
                        <span v-if="current_action === 'stop'" class="loading loading-spinner loading-xs"></span>
                        <span>🛑 {{ current_action === 'stop' ? 'Stopping' : 'Stop' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_PauseVmsAdmin()" :disabled="loading">
                        <span v-if="current_action === 'pause'" class="loading loading-spinner loading-xs"></span>
                        <span>⏸️ {{ current_action === 'pause' ? 'Pausing' : 'Pause' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_ResumeVmsAdmin()" :disabled="loading">
                        <span v-if="current_action === 'resume'" class="loading loading-spinner loading-xs"></span>
                        <span>▶️ {{ current_action === 'resume' ? 'Resuming' : 'Resume' }}</span>
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
                  <summary> ⚡ Student Virtual Machines </summary>
                  <ul class="mt-2 space-y-2">
                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_StartVmsStudent()" :disabled="loading">
                        <span v-if="current_action === 'start'" class="loading loading-spinner loading-xs"></span>
                        <span>🟢 {{ current_action === 'start' ? 'Starting' : 'Start' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_StopVmsStudent()" :disabled="loading">
                        <span v-if="current_action === 'stop'" class="loading loading-spinner loading-xs"></span>
                        <span>🛑 {{ current_action === 'stop' ? 'Stopping' : 'Stop' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_PauseVmsStudent()" :disabled="loading">
                        <span v-if="current_action === 'pause'" class="loading loading-spinner loading-xs"></span>
                        <span>⏸️ {{ current_action === 'pause' ? 'Pausing' : 'Pause' }}</span>
                      </button>
                    </li>

                    <li>
                      <button class="btn btn-ghost inline-flex items-center gap-2"
                        @click="handleBundleCoreProxmoxConfigureDefault_ResumeVmsStudent()" :disabled="loading">
                        <span v-if="current_action === 'resume'" class="loading loading-spinner loading-xs"></span>
                        <span>▶️ {{ current_action === 'resume' ? 'Resuming' : 'Resume' }}</span>
                      </button>
                    </li>
                  </ul>
                </details>
              </li>

              <p v-if="error" class="m-4 p-4  bg-red-500 text-white  ">
                {{ error }}
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

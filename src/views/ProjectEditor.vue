<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow } from '@vue-flow/core'
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
import ConfigPanel from '../components/ConfigPanel.vue'

import { useInfraBuilder } from '../composables/useInfraBuilder'
import { useDragAndDrop } from '../composables/useDragAndDrop'
import { useProjectStore } from '../stores/projectStore'

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

const { onDragOver, onDrop, onDragLeave, isDragOver } = useDragAndDrop()

const showConfigPanel = ref(false)
const currentProject = ref(null)

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

      <div class="drawer-content flex flex-col">
        <!-- Navbar -->
        <div class="navbar bg-base-200">
          <div class="navbar-start">
            <label for="drawer-toggle" class="btn btn-square btn-ghost lg:hidden">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </label>
            <button class="btn btn-ghost" @click="goBack">
              ← Back
            </button>
          </div>

          <div class="navbar-center">
            <h1 class="text-xl font-bold">{{ currentProject.name }}</h1>
          </div>

          <div class="navbar-end">
            <div class="dropdown dropdown-end">
              <label tabindex="0" class="btn btn-ghost">⚙️</label>
              <ul class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
                <li><a @click="projectStore.exportProject(currentProject.id)">📤 Export Project</a></li>
                <li><a>🚀 Deploy (Coming Soon)</a></li>
                <li><a>🔍 Validate Configuration (Coming Soon)</a></li>
              </ul>
            </div>
          </div>
        </div>

        <!-- VueFlow Canvas -->
        <div 
          class="flex-1 relative transition-colors duration-200"
          :class="{ 'bg-primary bg-opacity-5': isDragOver }"
          @drop="handleDrop"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
        >
          <VueFlow
            :nodes="nodes"
            :edges="edges"
            @connect="onConnect"
            @node-click="handleNodeClick"
            @nodes-change="onNodesChange"
            @edges-change="onEdgesChange"
            fit-view-on-init
            elevate-edges-on-select
            class="h-full w-full"
          >
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
          <div 
            v-if="isDragOver" 
            class="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          >
            <div class="alert alert-info max-w-md">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span>Drop here to create component or inside a network zone</span>
            </div>
          </div>
        </div>
      </div>

      <div class="drawer-side">
        <label for="drawer-toggle" class="drawer-overlay"></label>
        <Sidebar class="min-h-full" :project="currentProject" />
      </div>
    </div>

    <ConfigPanel
      v-if="selectedNode && showConfigPanel"
      :node="selectedNode"
      @close="closeConfigPanel"
      @update="updateNodeStatus"
    />
  </div>
</template>
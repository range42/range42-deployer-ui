<script setup>
import { computed } from 'vue'
import { useDragAndDrop } from '../composables/useDragAndDrop'
import { useProjectStore } from '../stores/projectStore'

const props = defineProps(['project'])

const { onDragStart } = useDragAndDrop()
const projectStore = useProjectStore()

// Use the project prop passed from parent component
const currentProject = computed(() => props.project)

const nodeTypes = [
  {
    type: 'vm',
    label: 'Virtual Machine',
    icon: '🖥️',
    description: 'Create a virtual machine instance'
  },
  {
    type: 'network',
    label: 'Network',
    icon: '🌐',
    description: 'Create a network infrastructure'
  },
  {
    type: 'docker',
    label: 'Docker Container',
    icon: '🐳',
    description: 'Deploy a containerized application'
  }
]

const exportProject = () => {
  if (currentProject.value) {
    projectStore.exportProject(currentProject.value.id)
  }
}

const importProject = () => {
  // For now, redirect to dashboard for import functionality
  // You could implement a more sophisticated import here
  alert('Import functionality available from the dashboard')
}
</script>

<template>
  <div class="w-80 bg-base-200 p-4 space-y-6">
    <!-- Header -->
    <div class="text-center">
      <h2 class="text-2xl font-bold">🏗️ Range42</h2>
      <p class="text-sm opacity-70">Visual Infrastructure Builder</p>
    </div>

    <!-- Project Info -->
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <h3 class="card-title text-sm">Current Project</h3>
        <p class="text-xs opacity-70">{{ currentProject?.name || 'Untitled Project' }}</p>
        <div class="text-xs opacity-50">
          {{ currentProject?.nodes?.length || 0 }} components
        </div>
      </div>
    </div>

    <!-- Infrastructure Components -->
    <div class="space-y-3">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        Drag Components
      </h3>
      
      <div class="space-y-2">
        <div
          v-for="nodeType in nodeTypes"
          :key="nodeType.type"
          class="card bg-base-100 shadow-sm cursor-grab hover:shadow-md transition-shadow"
          :draggable="true"
          @dragstart="onDragStart($event, nodeType.type)"
        >
          <div class="card-body p-3">
            <div class="flex items-center space-x-3">
              <span class="text-2xl">{{ nodeType.icon }}</span>
              <div class="flex-1">
                <div class="font-medium text-sm">{{ nodeType.label }}</div>
                <div class="text-xs opacity-70">{{ nodeType.description }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Inventory -->
    <div class="space-y-3">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        Inventory
      </h3>
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-3">
          <div class="text-sm">Template Library</div>
          <div class="text-xs opacity-70">Pre-configured components</div>
          <div class="mt-2">
            <div class="badge badge-outline badge-sm">Coming Soon</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Project Actions -->
    <div class="space-y-2">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        Project Actions
      </h3>
      
      <div class="flex flex-col space-y-2">
        <button class="btn btn-sm btn-outline" @click="exportProject">
          📤 Export
        </button>
        <button class="btn btn-sm btn-outline" @click="importProject">
          📥 Import
        </button>
      </div>
    </div>

    <!-- Status Legend -->
    <div class="space-y-2">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        Status Legend
      </h3>
      <div class="space-y-1 text-xs">
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-gray-400"></div>
          <span>Incomplete</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-orange-400"></div>
          <span>Ready to Deploy</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-green-400"></div>
          <span>Deployed</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-red-400"></div>
          <span>Error</span>
        </div>
      </div>
    </div>
  </div>
</template>
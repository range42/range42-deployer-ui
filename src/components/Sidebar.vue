<script setup>
import { computed } from 'vue'
import { useDragAndDrop } from '../composables/useDragAndDrop'

const props = defineProps(['project'])
const emit = defineEmits(['openExport'])
const { onDragStart } = useDragAndDrop()

const currentProject = computed(() => props.project)

const infrastructureComponents = [
  {
    category: 'Compute & Virtualization',
    items: [
      {
        type: 'vm',
        label: 'Virtual Machine',
        icon: '🖥️',
        description: 'Deploy a virtual machine instance'
      },
      {
        type: 'docker',
        label: 'Container',
        icon: '🐳',
        description: 'Deploy a containerized application'
      }
    ]
  },
  {
    category: 'Network Infrastructure',
    items: [
      {
        type: 'network-segment',
        label: 'Network Segment',
        icon: '🌐',
        description: 'Create isolated network segment'
      },
      {
        type: 'router',
        label: 'Router',
        icon: '🔄',
        description: 'Layer 3 routing device'
      },
      {
        type: 'switch',
        label: 'Switch',
        icon: '🔀',
        description: 'Layer 2 switching device'
      },
      {
        type: 'firewall',
        label: 'Firewall',
        icon: '🔥',
        description: 'Network security appliance'
      }
    ]
  },
  {
    category: 'Network Services',
    items: [
      {
        type: 'dns',
        label: 'DNS Server',
        icon: '🔍',
        description: 'Domain name resolution'
      },
      {
        type: 'dhcp',
        label: 'DHCP Server',
        icon: '📋',
        description: 'Dynamic IP assignment'
      },
      {
        type: 'loadbalancer',
        label: 'Load Balancer',
        icon: '⚖️',
        description: 'Traffic distribution'
      }
    ]
  }
]

const openExport = () => {
  emit('openExport')
}
</script>

<template>
  <div class="w-80 bg-base-200 p-4 space-y-6">
    <!-- Header -->
    <div class="text-center">
      <h2 class="text-2xl font-bold">🏗️ Range42</h2>
      <p class="text-sm opacity-70">Cyber Range Infrastructure Builder</p>
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

    <!-- Infrastructure Components by Category -->
    <div class="space-y-4">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        Infrastructure Components
      </h3>
      
      <div v-for="category in infrastructureComponents" :key="category.category" class="space-y-2">
        <h4 class="text-xs font-medium opacity-60 uppercase tracking-wide">
          {{ category.category }}
        </h4>
        
        <div class="space-y-2">
          <div
            v-for="component in category.items"
            :key="component.type"
            class="card bg-base-100 shadow-sm cursor-grab hover:shadow-md transition-shadow border border-base-300 hover:border-primary/30"
            :draggable="true"
            @dragstart="onDragStart($event, component.type)"
          >
            <div class="card-body p-3">
              <div class="flex items-center space-x-3">
                <span class="text-xl">{{ component.icon }}</span>
                <div class="flex-1">
                  <div class="font-medium text-sm">{{ component.label }}</div>
                  <div class="text-xs opacity-70">{{ component.description }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
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
          <span>Incomplete Configuration</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-orange-400"></div>
          <span>Ready to Deploy</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-green-400"></div>
          <span>Deployed & Running</span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-3 h-3 rounded-full bg-red-400"></div>
          <span>Error / Failed</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="space-y-2">
      <h3 class="font-semibold text-sm uppercase tracking-wide opacity-70">
        Quick Actions
      </h3>
      
      <div class="flex flex-col space-y-2">
        <button class="btn btn-sm btn-outline" @click="openExport">
          📤 Export Configuration
        </button>
        <button class="btn btn-sm btn-outline" disabled>
          🚀 Deploy Infrastructure (Coming Soon)
        </button>
        <button class="btn btn-sm btn-outline" disabled>
          🔍 Validate Configuration (Coming Soon)
        </button>
      </div>
    </div>
  </div>
</template>
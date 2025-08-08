<script setup>
import { ref, computed } from 'vue'
import { useExport } from '../composables/useExport'

const props = defineProps(['project', 'visible', 'nodes', 'edges'])
const emit = defineEmits(['close'])

const { 
  isExporting, 
  exportErrors, 
  exportProject, 
  downloadExport 
} = useExport()

const selectedFormat = ref('all')
const exportData = ref(null)
const currentStep = ref(1)

const exportOptions = [
  { 
    value: 'all', 
    label: 'Complete Deployment Package', 
    description: 'Ansible playbooks, Docker Compose files, configurations, and documentation',
    icon: '📦'
  },
  { 
    value: 'ansible', 
    label: 'Ansible Playbooks Only', 
    description: 'VM provisioning and service deployment playbooks',
    icon: '🤖' 
  },
  { 
    value: 'docker-compose', 
    label: 'Docker Compose Only', 
    description: 'Container orchestration files',
    icon: '🐳' 
  }
]

const selectedOption = computed(() => 
  exportOptions.find(opt => opt.value === selectedFormat.value)
)

const incomingNodesCount = computed(() => {
  const overridden = Array.isArray(props.nodes) ? props.nodes.length : 0
  if (overridden > 0) return overridden
  const proj = props.project
  return (proj && Array.isArray(proj.nodes)) ? proj.nodes.length : 0
})

const handleExport = async () => {
  if (!props.project) return
  
  currentStep.value = 2
  exportData.value = await exportProject(
    props.project,
    selectedFormat.value,
    {
      nodes: Array.isArray(props.nodes) ? props.nodes : (props.project?.nodes || []),
      edges: Array.isArray(props.edges) ? props.edges : (props.project?.edges || [])
    }
  )
  
  if (exportData.value && !exportErrors.value.length) {
    currentStep.value = 3
  }
}

const handleDownload = async () => {
  if (!exportData.value) return
  await downloadExport(exportData.value, props.project.name)
  emit('close')
}

const resetModal = () => {
  currentStep.value = 1
  exportData.value = null
  selectedFormat.value = 'all'
}

const handleClose = () => {
  resetModal()
  emit('close')
}
</script>

<template>
  <div v-if="visible" class="modal modal-open">
    <div class="modal-box w-full max-w-4xl max-h-[90vh] overflow-y-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center space-x-3">
          <span class="text-3xl">🏗️</span>
          <div>
            <h3 class="text-2xl font-bold">Export for Proxmox</h3>
            <p class="text-sm opacity-70">Generate Ansible deployment package</p>
          </div>
        </div>
        <button class="btn btn-sm btn-circle btn-ghost" @click="handleClose">✕</button>
      </div>

      <!-- Steps indicator -->
      <div class="steps w-full mb-8">
        <div class="step step-primary">Configure</div>
        <div class="step" :class="{ 'step-primary': currentStep >= 2 }">Generate</div>
        <div class="step" :class="{ 'step-primary': currentStep >= 3 }">Download</div>
      </div>

      <!-- Step 1: Export Options -->
      <div v-if="currentStep === 1" class="space-y-6">
        <div class="alert alert-info">
          <div class="text-2xl">🎯</div>
          <div>
            <h4 class="font-bold">Proxmox + Ansible Deployment</h4>
            <p class="text-sm">Generate infrastructure-as-code for on-premises deployment using Proxmox VE and Ansible automation.</p>
          </div>
        </div>

        <div class="form-control">
          <label class="label">
            <span class="label-text font-semibold">Export Package</span>
          </label>
          <div class="grid grid-cols-1 gap-4">
            <div 
              v-for="option in exportOptions" 
              :key="option.value"
              class="card cursor-pointer transition-all hover:shadow-md"
              :class="{ 
                'border-2 border-primary bg-primary/5': selectedFormat === option.value,
                'border border-base-300': selectedFormat !== option.value
              }"
              @click="selectedFormat = option.value"
            >
              <div class="card-body p-4">
                <div class="flex items-start space-x-3">
                  <span class="text-2xl">{{ option.icon }}</span>
                  <div class="flex-1">
                    <div class="flex items-center space-x-2 mb-2">
                      <input 
                        type="radio" 
                        :checked="selectedFormat === option.value"
                        class="radio radio-primary" 
                        readonly
                      />
                      <h4 class="font-semibold">{{ option.label }}</h4>
                    </div>
                    <p class="text-sm opacity-70">{{ option.description }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Prerequisites info -->
        <div class="card bg-base-100 border">
          <div class="card-body">
            <h5 class="card-title text-lg">📋 Prerequisites</h5>
            <div class="text-sm space-y-2">
              <div class="flex items-center space-x-2">
                <span class="w-2 h-2 bg-primary rounded-full"></span>
                <span>Proxmox VE 8.0+ with VM template configured</span>
              </div>
              <div class="flex items-center space-x-2">
                <span class="w-2 h-2 bg-primary rounded-full"></span>
                <span>Ansible with community.general and community.docker collections</span>
              </div>
              <div class="flex items-center space-x-2">
                <span class="w-2 h-2 bg-primary rounded-full"></span>
                <span>SSH access to Proxmox server</span>
              </div>
            </div>
          </div>
        </div>

        <div class="alert alert-warning" v-if="incomingNodesCount === 0">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <h4 class="font-bold">Empty Project</h4>
            <p class="text-sm">Your project contains no components to export.</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Generation Progress -->
      <div v-if="currentStep === 2" class="space-y-6">
        <div class="text-center">
          <div v-if="isExporting" class="text-primary">
            <div class="loading loading-spinner loading-lg mb-4"></div>
            <div class="text-xl font-semibold">Generating Deployment Package</div>
            <div class="text-sm opacity-70 mt-2">Creating Ansible playbooks and configurations...</div>
          </div>
          <div v-else-if="exportErrors.length > 0" class="text-error">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="text-xl font-semibold">Export Failed</div>
          </div>
          <div v-else class="text-success">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            <div class="text-xl font-semibold">Package Generated!</div>
          </div>
        </div>

        <!-- Errors -->
        <div v-if="exportErrors.length > 0" class="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <h4 class="font-bold">Configuration Errors</h4>
            <ul class="text-sm mt-2 space-y-1">
              <li v-for="error in exportErrors" :key="error">• {{ error }}</li>
            </ul>
          </div>
        </div>

        <!-- Export Summary -->
        <div v-if="exportData && !exportErrors.length" class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="stat bg-base-200 rounded-lg">
            <div class="stat-title">VMs</div>
            <div class="stat-value text-lg">{{ exportData.analysis.hosts.length }}</div>
            <div class="stat-desc">Proxmox virtual machines</div>
          </div>
          <div class="stat bg-base-200 rounded-lg">
            <div class="stat-title">Services</div>
            <div class="stat-value text-lg">{{ exportData.analysis.services.length }}</div>
            <div class="stat-desc">Docker containers</div>
          </div>
          <div class="stat bg-base-200 rounded-lg">
            <div class="stat-title">Networks</div>
            <div class="stat-value text-lg">{{ exportData.analysis.networks.length }}</div>
            <div class="stat-desc">Network segments</div>
          </div>
        </div>
      </div>

      <!-- Step 3: Download -->
      <div v-if="currentStep === 3" class="space-y-6">
        <div class="text-center">
          <div class="text-success mb-4">
            <div class="text-6xl mb-2">🎉</div>
          </div>
          <h4 class="text-xl font-semibold mb-2">Deployment Package Ready!</h4>
          <p class="opacity-70 mb-6">Your Proxmox infrastructure package has been generated and is ready for download.</p>
        </div>

        <!-- Package contents -->
        <div class="card bg-base-100 border">
          <div class="card-body">
            <h5 class="card-title text-lg flex items-center space-x-2">
              <span>📦</span>
              <span>Package Contents</span>
            </h5>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div class="space-y-3">
                <div class="flex items-center space-x-3">
                  <div class="badge badge-primary">Ansible</div>
                  <div class="text-sm">
                    <div class="font-medium">VM Provisioning</div>
                    <div class="opacity-70">proxmox-provision.yml</div>
                  </div>
                </div>
                
                <div class="flex items-center space-x-3">
                  <div class="badge badge-secondary">Ansible</div>
                  <div class="text-sm">
                    <div class="font-medium">Service Deployment</div>
                    <div class="opacity-70">deploy-services.yml</div>
                  </div>
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-center space-x-3">
                  <div class="badge badge-accent">Docker</div>
                  <div class="text-sm">
                    <div class="font-medium">Service Definitions</div>
                    <div class="opacity-70">docker-compose/*.yml</div>
                  </div>
                </div>
                
                <div class="flex items-center space-x-3">
                  <div class="badge badge-info">Scripts</div>
                  <div class="text-sm">
                    <div class="font-medium">Deploy & Cleanup</div>
                    <div class="opacity-70">deploy.sh, cleanup.sh</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Deployment architecture -->
        <div v-if="exportData.analysis.deploymentGroups.size > 0" class="card bg-base-100 border">
          <div class="card-body">
            <h5 class="card-title text-lg flex items-center space-x-2">
              <span>🏗️</span>
              <span>Infrastructure Overview</span>
            </h5>
            
            <div class="space-y-4 mt-4">
              <div 
                v-for="[hostId, group] in exportData.analysis.deploymentGroups" 
                :key="hostId"
                class="border border-base-300 rounded-lg p-4"
              >
                <div class="flex items-center space-x-2 mb-3">
                  <span class="text-lg">🖥️</span>
                  <h6 class="font-semibold">{{ group.host.data.config.name || 'VM' }}</h6>
                  <div class="badge badge-sm badge-outline">
                    {{ group.host.data.config.cpu || 2 }} CPU
                  </div>
                  <div class="badge badge-sm badge-outline">
                    {{ group.host.data.config.memory || '2GB' }} RAM
                  </div>
                </div>
                
                <div v-if="group.services.length > 0" class="ml-6 space-y-2">
                  <p class="text-sm font-medium opacity-70">Services:</p>
                  <div class="flex flex-wrap gap-2">
                    <div 
                      v-for="service in group.services" 
                      :key="service.id"
                      class="badge badge-sm badge-primary"
                    >
                      {{ service.data.config.name || service.type }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Next steps -->
        <div class="alert alert-success">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 w-6 h-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div>
            <h4 class="font-bold">Next Steps</h4>
            <ol class="text-sm mt-2 space-y-1 list-decimal list-inside">
              <li>Download and extract the deployment package</li>
              <li>Update inventory.yml with your Proxmox details</li>
              <li>Run the deployment script: <code>./scripts/deploy.sh</code></li>
              <li>Access your services once deployment completes</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <div class="flex justify-between items-center w-full">
          <div>
            <button 
              v-if="currentStep > 1" 
              class="btn btn-ghost"
              @click="currentStep = Math.max(1, currentStep - 1)"
            >
              ← Back
            </button>
          </div>
          
          <div class="space-x-2">
            <button class="btn btn-ghost" @click="handleClose">Close</button>
            
            <button 
              v-if="currentStep === 1"
              class="btn btn-primary" 
              @click="handleExport"
              :disabled="!project || incomingNodesCount === 0 || isExporting"
            >
              🚀 Generate Package
            </button>
            
            <button 
              v-if="currentStep === 3"
              class="btn btn-primary" 
              @click="handleDownload"
            >
              📥 Download Package
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
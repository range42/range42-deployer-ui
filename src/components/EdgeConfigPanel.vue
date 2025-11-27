<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  edge: {
    type: Object,
    required: true
  },
  sourceNode: {
    type: Object,
    default: null
  },
  targetNode: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'update'])

// Local form state
const config = ref({
  ipAddress: '',
  useDhcp: true,
  interfaceModel: 'virtio',
  macAddress: '',
  firewall: true
})

// Initialize form from edge data
watch(() => props.edge, (edge) => {
  if (edge?.data) {
    config.value = {
      ipAddress: edge.data.ipAddress || '',
      useDhcp: edge.data.useDhcp ?? true,
      interfaceModel: edge.data.interfaceModel || 'virtio',
      macAddress: edge.data.macAddress || '',
      firewall: edge.data.firewall ?? true
    }
  }
}, { immediate: true })

// Determine which node is the compute resource and which is the network
const computeNode = computed(() => {
  const computeTypes = ['vm', 'lxc', 'edge-firewall', 'router']
  if (computeTypes.includes(props.sourceNode?.type)) return props.sourceNode
  if (computeTypes.includes(props.targetNode?.type)) return props.targetNode
  return null
})

const networkNode = computed(() => {
  if (props.sourceNode?.type === 'network-segment') return props.sourceNode
  if (props.targetNode?.type === 'network-segment') return props.targetNode
  return null
})

// Network CIDR for reference
const networkCidr = computed(() => networkNode.value?.data?.config?.cidr || 'N/A')

// Auto-update parent when config changes
watch(config, (newConfig) => {
  emit('update', props.edge.id, newConfig)
}, { deep: true })

const close = () => {
  emit('close')
}
</script>

<template>
  <div class="edge-config-panel card bg-base-200 shadow-xl">
    <div class="card-body p-4">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="card-title text-base">
          🔗 Network Connection
        </h3>
        <button class="btn btn-sm btn-circle btn-ghost" @click="close">✕</button>
      </div>

      <!-- Connection Info -->
      <div class="alert alert-info mb-4 py-2">
        <div class="text-xs">
          <div v-if="computeNode" class="flex items-center gap-2">
            <span class="font-semibold">{{ computeNode.data?.config?.name || computeNode.type }}</span>
            <span>→</span>
            <span class="font-semibold">{{ networkNode?.data?.config?.name || 'Network' }}</span>
            <span class="opacity-70">({{ networkCidr }})</span>
          </div>
        </div>
      </div>

      <!-- IP Configuration -->
      <div class="form-control mb-3">
        <label class="cursor-pointer label justify-start gap-4">
          <input v-model="config.useDhcp" type="checkbox" class="toggle toggle-primary toggle-sm" />
          <div>
            <span class="label-text font-medium">Use DHCP</span>
            <p class="text-xs opacity-70">Get IP from network segment</p>
          </div>
        </label>
      </div>

      <div v-if="!config.useDhcp" class="form-control mb-3">
        <label class="label py-1">
          <span class="label-text text-sm">Static IP Address</span>
        </label>
        <input 
          v-model="config.ipAddress" 
          type="text" 
          class="input input-bordered input-sm" 
          placeholder="e.g., 192.168.1.10"
        />
      </div>

      <!-- Interface Model -->
      <div class="form-control mb-3">
        <label class="label py-1">
          <span class="label-text text-sm">Interface Model</span>
        </label>
        <select v-model="config.interfaceModel" class="select select-bordered select-sm">
          <option value="virtio">VirtIO (recommended)</option>
          <option value="e1000">Intel E1000</option>
          <option value="rtl8139">Realtek RTL8139</option>
          <option value="vmxnet3">VMware vmxnet3</option>
        </select>
      </div>

      <!-- MAC Address -->
      <div class="form-control mb-3">
        <label class="label py-1">
          <span class="label-text text-sm">MAC Address</span>
          <span class="label-text-alt text-xs">Optional</span>
        </label>
        <input 
          v-model="config.macAddress" 
          type="text" 
          class="input input-bordered input-sm" 
          placeholder="Auto-generated"
        />
      </div>

      <!-- Firewall -->
      <div class="form-control">
        <label class="cursor-pointer label justify-start gap-4">
          <input v-model="config.firewall" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />
          <div>
            <span class="label-text text-sm">Enable Firewall</span>
            <p class="text-xs opacity-70">Proxmox firewall on this interface</p>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edge-config-panel {
  min-width: 280px;
  max-width: 320px;
}
</style>

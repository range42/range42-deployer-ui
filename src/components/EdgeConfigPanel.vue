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

// Local form state - matches NetworkConnectionData type
const config = ref({
  interfaceModel: 'virtio',
  ipAddress: '',
  macAddress: '',
  firewall: true,
  vlanTag: null,
  mtu: null,
  rate: null,
  // UI helper
  useDhcp: true
})

// Initialize form from edge data
watch(() => props.edge, (edge) => {
  if (edge?.data?.connection) {
    const conn = edge.data.connection
    config.value = {
      interfaceModel: conn.interfaceModel || 'virtio',
      ipAddress: conn.ipAddress || '',
      macAddress: conn.macAddress || '',
      firewall: conn.firewall ?? true,
      vlanTag: conn.vlanTag || null,
      mtu: conn.mtu || null,
      rate: conn.rate || null,
      useDhcp: !conn.ipAddress
    }
  } else if (edge?.data) {
    // Legacy format
    config.value = {
      interfaceModel: edge.data.interfaceModel || 'virtio',
      ipAddress: edge.data.ipAddress || '',
      macAddress: edge.data.macAddress || '',
      firewall: edge.data.firewall ?? true,
      vlanTag: edge.data.vlanTag || null,
      mtu: edge.data.mtu || null,
      rate: edge.data.rate || null,
      useDhcp: edge.data.useDhcp ?? true
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

// Format config as NetworkConnectionData for the edge
const connectionData = computed(() => ({
  interfaceModel: config.value.interfaceModel,
  ipAddress: config.value.useDhcp ? undefined : config.value.ipAddress || undefined,
  macAddress: config.value.macAddress || undefined,
  firewall: config.value.firewall,
  vlanTag: config.value.vlanTag || undefined,
  mtu: config.value.mtu || undefined,
  rate: config.value.rate || undefined,
}))

// Auto-update parent when config changes
watch(config, () => {
  // Emit the edge data in the correct format: { connection: NetworkConnectionData }
  emit('update', props.edge.id, { 
    connection: connectionData.value,
    label: config.value.ipAddress || undefined
  })
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

      <!-- VLAN Tag -->
      <div class="form-control mb-3">
        <label class="label py-1">
          <span class="label-text text-sm">VLAN Tag</span>
          <span class="label-text-alt text-xs">Optional</span>
        </label>
        <input 
          v-model.number="config.vlanTag" 
          type="number" 
          class="input input-bordered input-sm" 
          placeholder="1-4094"
          min="1"
          max="4094"
        />
      </div>

      <!-- Advanced Options -->
      <div class="collapse collapse-arrow bg-base-100 rounded-box mb-3">
        <input type="checkbox" />
        <div class="collapse-title text-sm font-medium py-2 min-h-0">
          Advanced Options
        </div>
        <div class="collapse-content">
          <!-- MTU -->
          <div class="form-control mb-2">
            <label class="label py-1">
              <span class="label-text text-sm">MTU</span>
            </label>
            <input 
              v-model.number="config.mtu" 
              type="number" 
              class="input input-bordered input-sm" 
              placeholder="Default (1500)"
              min="576"
              max="65535"
            />
          </div>

          <!-- Rate Limit -->
          <div class="form-control">
            <label class="label py-1">
              <span class="label-text text-sm">Rate Limit (MB/s)</span>
            </label>
            <input 
              v-model.number="config.rate" 
              type="number" 
              class="input input-bordered input-sm" 
              placeholder="Unlimited"
              min="1"
            />
          </div>
        </div>
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

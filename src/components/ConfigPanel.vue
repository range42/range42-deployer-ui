<script setup>
import { ref, computed, watch, onMounted } from 'vue'

const props = defineProps(['node'])
const emit = defineEmits(['close', 'update'])


const errors = ref([])
const isLoading = ref(false)

const config = ref({})

onMounted(() => {
  if (props.node?.data?.config) {
    config.value = { ...props.node.data.config }
  }
})

// Add validation
const validateConfig = () => {
  errors.value = []
  
  if (!config.value.name?.trim()) {
    errors.value.push('Name is required')
  }
  
  // Add type-specific validations
  switch (props.node?.type) {
    case 'vm':
      if (!config.value.cpu || config.value.cpu < 1) {
        errors.value.push('CPU cores must be at least 1')
      }
      if (!config.value.memory?.trim()) {
        errors.value.push('Memory is required')
      }
      break
    //TODO Add more validations maybe something to be done via settings
  }
  
  return errors.value.length === 0
}

const isValid = computed(() => {
  return validateConfig()
})


// Add network interface management for routers
const addInterface = () => {
  if (!config.value.interfaces) config.value.interfaces = []
  config.value.interfaces.push({
    name: `eth${config.value.interfaces.length}`,
    ip: '',
    subnet: '',
    description: ''
  })
}

const removeInterface = (index) => {
  config.value.interfaces.splice(index, 1)
}

// Add VLAN management for switches
const addVlan = () => {
  if (!config.value.vlans) config.value.vlans = []
  config.value.vlans.push({
    id: config.value.vlans.length + 1,
    name: `VLAN_${config.value.vlans.length + 1}`,
    description: ''
  })
}

const removeVlan = (index) => {
  config.value.vlans.splice(index, 1)
}

// Add firewall rule management
const addFirewallRule = () => {
  if (!config.value.rules) config.value.rules = []
  config.value.rules.push({
    action: 'allow',
    source: '',
    destination: '',
    port: '',
    protocol: 'tcp'
  })
}

const removeFirewallRule = (index) => {
  config.value.rules.splice(index, 1)
}

// Add server management for load balancer
const addServer = () => {
  if (!config.value.servers) config.value.servers = []
  config.value.servers.push({
    ip: '',
    port: '',
    weight: 1,
    status: 'active'
  })
}

const removeServer = (index) => {
  config.value.servers.splice(index, 1)
}

// Add DNS zone management
const addDnsZone = () => {
  if (!config.value.zones) config.value.zones = []
  config.value.zones.push({
    name: '',
    type: 'forward',
    description: ''
  })
}

const removeDnsZone = (index) => {
  config.value.zones.splice(index, 1)
}

const handleSave = () => {
  const newStatus = isValid.value ? 'orange' : 'gray'
  emit('update', props.node.id, { config: config.value, status: newStatus })
  emit('close')
}

const handleBackdropClick = (event) => {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}

watch(() => props.node, (newNode) => {
  if (newNode) {
    config.value = { ...newNode.data.config }
  }
}, { immediate: true })
</script>

<template>
  <div class="modal modal-open" @click="handleBackdropClick">
    <div class="modal-box w-full max-w-4xl max-h-[90vh] overflow-y-auto" @click.stop>
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-bold capitalize">
          Configure {{ node.type.replace('-', ' ') }}
        </h3>
        <button class="btn btn-sm btn-circle btn-ghost" @click="emit('close')">✕</button>
      </div>

      <!-- Content -->
      <div class="space-y-6">
        <!-- Common Fields -->
        <div class="form-control">
          <label class="label">
            <span class="label-text font-semibold">Name *</span>
          </label>
          <input
            v-model="config.name"
            type="text"
            class="input input-bordered w-full"
            :placeholder="`Enter ${node.type.replace('-', ' ')} name`"
          />
        </div>

        <!-- VM Specific Fields -->
        <template v-if="node.type === 'vm'">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">CPU Cores *</span>
              </label>
              <input
                v-model.number="config.cpu"
                type="number"
                class="input input-bordered"
                placeholder="e.g., 2"
                min="1"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Memory *</span>
              </label>
              <input
                v-model="config.memory"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 4GB"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Disk Size *</span>
              </label>
              <input
                v-model="config.disk"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 20GB"
              />
            </div>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Operating System</span>
            </label>
            <select v-model="config.os" class="select select-bordered">
              <option value="Ubuntu 22.04">Ubuntu 22.04</option>
              <option value="Ubuntu 20.04">Ubuntu 20.04</option>
              <option value="CentOS 8">CentOS 8</option>
              <option value="Windows Server 2022">Windows Server 2022</option>
              <option value="Windows Server 2019">Windows Server 2019</option>
              <option value="Kali Linux">Kali Linux</option>
              <option value="pfSense">pfSense</option>
            </select>
          </div>
        </template>

        <!-- Network Segment Specific Fields -->
        <template v-if="node.type === 'network-segment'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Segment Type *</span>
              </label>
              <select v-model="config.segmentType" class="select select-bordered">
                <option value="">Select segment type</option>
                <option value="management">Management Network</option>
                <option value="production">Production Network</option>
                <option value="dmz">DMZ</option>
                <option value="guest">Guest Network</option>
                <option value="iot">IoT/OT Network</option>
                <option value="security">Security Network</option>
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Security Level</span>
              </label>
              <select v-model="config.securityLevel" class="select select-bordered">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">CIDR Range *</span>
              </label>
              <input
                v-model="config.cidr"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.0/24"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">VLAN ID</span>
              </label>
              <input
                v-model.number="config.vlan"
                type="number"
                class="input input-bordered"
                placeholder="e.g., 100"
                min="1"
                max="4094"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Gateway *</span>
              </label>
              <input
                v-model="config.gateway"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.1"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">DNS Server</span>
              </label>
              <input
                v-model="config.dns"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.1"
              />
            </div>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">Enable DHCP</span>
              <input v-model="config.dhcp" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>
        </template>

        <!-- Router Specific Fields -->
        <template v-if="node.type === 'router'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Routing Protocol *</span>
              </label>
              <select v-model="config.routingProtocol" class="select select-bordered">
                <option value="OSPF">OSPF</option>
                <option value="BGP">BGP</option>
                <option value="EIGRP">EIGRP</option>
                <option value="RIP">RIP</option>
                <option value="Static">Static Routes</option>
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Router ID</span>
              </label>
              <input
                v-model="config.routerId"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 1.1.1.1"
              />
            </div>
          </div>

          <!-- Network Interface Management -->
          <div class="form-control">
            <label class="label">
              <span class="label-text font-semibold">Network Interfaces</span>
              <button type="button" @click="addInterface" class="btn btn-sm btn-primary">
                Add Interface
              </button>
            </label>
            <div v-if="config.interfaces?.length" class="space-y-3">
              <div
                v-for="(networkInterface, index) in config.interfaces"
                :key="index"
                class="border border-base-300 rounded-lg p-4"
              >
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    v-model="networkInterface.name"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Interface name"
                  />
                  <input
                    v-model="networkInterface.ip"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="IP Address"
                  />
                  <input
                    v-model="networkInterface.subnet"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Subnet mask"
                  />
                  <button
                    type="button"
                    @click="removeInterface(index)"
                    class="btn btn-sm btn-error"
                  >
                    Remove
                  </button>
                </div>
                <input
                  v-model="networkInterface.description"
                  type="text"
                  class="input input-bordered input-sm w-full mt-2"
                  placeholder="Description"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Switch Specific Fields -->
        <template v-if="node.type === 'switch'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Port Count *</span>
              </label>
              <select v-model.number="config.portCount" class="select select-bordered">
                <option :value="8">8 ports</option>
                <option :value="16">16 ports</option>
                <option :value="24">24 ports</option>
                <option :value="48">48 ports</option>
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Spanning Tree Protocol</span>
              </label>
              <select v-model="config.spanningTreeProtocol" class="select select-bordered">
                <option value="STP">STP</option>
                <option value="RSTP">RSTP</option>
                <option value="MSTP">MSTP</option>
              </select>
            </div>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">VLAN Support</span>
              <input v-model="config.vlanSupport" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">Port Security</span>
              <input v-model="config.portSecurity" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <!-- VLAN Management -->
          <div v-if="config.vlanSupport" class="form-control">
            <label class="label">
              <span class="label-text font-semibold">VLAN Configuration</span>
              <button type="button" @click="addVlan" class="btn btn-sm btn-primary">
                Add VLAN
              </button>
            </label>
            <div v-if="config.vlans?.length" class="space-y-2">
              <div
                v-for="(vlan, index) in config.vlans"
                :key="index"
                class="border border-base-300 rounded p-3"
              >
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    v-model.number="vlan.id"
                    type="number"
                    class="input input-bordered input-sm"
                    placeholder="VLAN ID"
                    min="1"
                    max="4094"
                  />
                  <input
                    v-model="vlan.name"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="VLAN Name"
                  />
                  <input
                    v-model="vlan.description"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Description"
                  />
                  <button
                    type="button"
                    @click="removeVlan(index)"
                    class="btn btn-sm btn-error"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Firewall Specific Fields -->
        <template v-if="node.type === 'firewall'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="cursor-pointer label">
                <span class="label-text">Enable NAT</span>
                <input v-model="config.natEnabled" type="checkbox" class="toggle toggle-primary" />
              </label>
            </div>

            <div class="form-control">
              <label class="cursor-pointer label">
                <span class="label-text">VPN Support</span>
                <input v-model="config.vpnSupport" type="checkbox" class="toggle toggle-primary" />
              </label>
            </div>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">Intrusion Detection</span>
              <input v-model="config.intrusionDetection" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <!-- Firewall Rules -->
          <div class="form-control">
            <label class="label">
              <span class="label-text font-semibold">Firewall Rules</span>
              <button type="button" @click="addFirewallRule" class="btn btn-sm btn-primary">
                Add Rule
              </button>
            </label>
            <div v-if="config.rules?.length" class="space-y-3">
              <div
                v-for="(rule, index) in config.rules"
                :key="index"
                class="border border-base-300 rounded-lg p-3"
              >
                <div class="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <select v-model="rule.action" class="select select-bordered select-sm">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                  <input
                    v-model="rule.source"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Source"
                  />
                  <input
                    v-model="rule.destination"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Destination"
                  />
                  <input
                    v-model="rule.port"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Port(s)"
                  />
                  <select v-model="rule.protocol" class="select select-bordered select-sm">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="icmp">ICMP</option>
                    <option value="any">Any</option>
                  </select>
                  <button
                    type="button"
                    @click="removeFirewallRule(index)"
                    class="btn btn-sm btn-error"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Load Balancer Specific Fields -->
        <template v-if="node.type === 'loadbalancer'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Load Balancing Algorithm *</span>
              </label>
              <select v-model="config.algorithm" class="select select-bordered">
                <option value="round-robin">Round Robin</option>
                <option value="least-connections">Least Connections</option>
                <option value="ip-hash">IP Hash</option>
                <option value="weighted-round-robin">Weighted Round Robin</option>
              </select>
            </div>

            <div class="form-control">
              <label class="cursor-pointer label">
                <span class="label-text">Health Check</span>
                <input v-model="config.healthCheck" type="checkbox" class="toggle toggle-primary" />
              </label>
            </div>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">SSL Termination</span>
              <input v-model="config.sslTermination" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <!-- Server Pool Management -->
          <div class="form-control">
            <label class="label">
              <span class="label-text font-semibold">Server Pool</span>
              <button type="button" @click="addServer" class="btn btn-sm btn-primary">
                Add Server
              </button>
            </label>
            <div v-if="config.servers?.length" class="space-y-2">
              <div
                v-for="(server, index) in config.servers"
                :key="index"
                class="border border-base-300 rounded p-3"
              >
                <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <input
                    v-model="server.ip"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Server IP"
                  />
                  <input
                    v-model="server.port"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Port"
                  />
                  <input
                    v-model.number="server.weight"
                    type="number"
                    class="input input-bordered input-sm"
                    placeholder="Weight"
                    min="1"
                  />
                  <select v-model="server.status" class="select select-bordered select-sm">
                    <option value="active">Active</option>
                    <option value="backup">Backup</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  <button
                    type="button"
                    @click="removeServer(index)"
                    class="btn btn-sm btn-error"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- DNS Server Specific Fields -->
        <template v-if="node.type === 'dns'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="cursor-pointer label">
                <span class="label-text">Enable Recursion</span>
                <input v-model="config.recursion" type="checkbox" class="toggle toggle-primary" />
              </label>
            </div>

            <div class="form-control">
              <label class="cursor-pointer label">
                <span class="label-text">DNSSEC</span>
                <input v-model="config.dnssec" type="checkbox" class="toggle toggle-primary" />
              </label>
            </div>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Forwarders (comma-separated)</span>
            </label>
            <input
              v-model="config.forwarders"
              type="text"
              class="input input-bordered"
              placeholder="8.8.8.8,1.1.1.1"
            />
          </div>

          <!-- DNS Zone Management -->
          <div class="form-control">
            <label class="label">
              <span class="label-text font-semibold">DNS Zones *</span>
              <button type="button" @click="addDnsZone" class="btn btn-sm btn-primary">
                Add Zone
              </button>
            </label>
            <div v-if="config.zones?.length" class="space-y-2">
              <div
                v-for="(zone, index) in config.zones"
                :key="index"
                class="border border-base-300 rounded p-3"
              >
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    v-model="zone.name"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Zone name"
                  />
                  <select v-model="zone.type" class="select select-bordered select-sm">
                    <option value="forward">Forward</option>
                    <option value="reverse">Reverse</option>
                  </select>
                  <input
                    v-model="zone.description"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="Description"
                  />
                  <button
                    type="button"
                    @click="removeDnsZone(index)"
                    class="btn btn-sm btn-error"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- DHCP Server Specific Fields -->
        <template v-if="node.type === 'dhcp'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">IP Range/Scope *</span>
              </label>
              <input
                v-model="config.scope"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.100-200"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Lease Time</span>
              </label>
              <input
                v-model="config.leaseTime"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 24h, 7d"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Default Gateway *</span>
              </label>
              <input
                v-model="config.gateway"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.1"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">DNS Servers (comma-separated)</span>
              </label>
              <input
                v-model="config.dnsServers"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.1,8.8.8.8"
              />
            </div>
          </div>
        </template>

  
        <template v-if="node.type === 'docker'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Docker Image *</span>
              </label>
              <input
                v-model="config.image"
                type="text"
                class="input input-bordered"
                placeholder="e.g., nginx:latest"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Port Mapping *</span>
              </label>
              <input
                v-model="config.ports"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 80:80,443:443"
              />
            </div>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Environment Variables</span>
            </label>
            <textarea
              v-model="config.env"
              class="textarea textarea-bordered"
              placeholder="KEY=value (one per line)"
              rows="4"
            ></textarea>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Container Network</span>
            </label>
            <select v-model="config.network" class="select select-bordered">
              <option value="bridge">Bridge (Default)</option>
              <option value="host">Host Network</option>
              <option value="none">No Network</option>
              <option value="custom">Custom Network</option>
            </select>
          </div>
        </template>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <div class="flex justify-between items-center w-full">
          <div class="text-sm">
            <span :class="isValid ? 'text-success' : 'text-warning'">
              {{ isValid ? '✓ Configuration valid' : '⚠ Missing required fields' }}
            </span>
          </div>
          <div class="space-x-2">
            <button class="btn btn-ghost" @click="emit('close')">Cancel</button>
            <button class="btn btn-primary" @click="handleSave">Save Configuration</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
const { t } = useI18n({ useScope: 'global' })

const props = defineProps(['node'])
const emit = defineEmits(['close', 'update', 'delete'])


const errors = ref([])
const isLoading = ref(false)

const config = ref({})

onMounted(() => {
  if (props.node?.data?.config) {
    config.value = { ...props.node.data.config }
  }
  // Load i18n namespaces used by this panel
  ensureNamespaces(['configPanel', 'common'])
})

// Add validation
const validateConfig = () => {
  errors.value = []
  
  if (!config.value.name?.trim()) {
    errors.value.push(t('configPanel.validation.nameRequired'))
  }
  
  // Add type-specific validations
  switch (props.node?.type) {
    case 'vm':
      if (!config.value.cpu || config.value.cpu < 1) {
        errors.value.push(t('configPanel.validation.cpuMin'))
      }
      if (!config.value.memory?.trim()) {
        errors.value.push(t('configPanel.validation.memoryRequired'))
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

const handleDelete = () => {
  if (confirm(`Are you sure you want to delete "${config.value.name || props.node.type}"?`)) {
    emit('delete', props.node.id)
    emit('close')
  }
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
          {{ t('configPanel.header', { type: node.type.replace('-', ' ') }) }}
        </h3>
        <button class="btn btn-sm btn-circle btn-ghost" @click="emit('close')">✕</button>
      </div>

      <!-- Content -->
      <div class="space-y-6">
        <!-- Common Fields -->
        <div class="form-control">
          <label class="label">
            <span class="label-text font-semibold">{{ t('configPanel.fields.name') }} *</span>
          </label>
          <input
            v-model="config.name"
            type="text"
            class="input input-bordered w-full"
            :placeholder="t('configPanel.placeholders.name', { type: node.type.replace('-', ' ') })"
          />
        </div>

        <!-- VM Specific Fields -->
        <template v-if="node.type === 'vm'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="config.description"
              class="textarea textarea-bordered"
              placeholder="VM description..."
              rows="2"
            ></textarea>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">IP Address</span>
            </label>
            <input
              v-model="config.ipAddress"
              type="text"
              class="input input-bordered"
              placeholder="e.g., 192.168.1.10"
            />
            <label class="label">
              <span class="label-text-alt">Static IP for this VM (used during deployment)</span>
            </label>
          </div>
        </template>

        <!-- Network Segment Specific Fields -->
        <template v-if="node.type === 'network-segment'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="config.description"
              class="textarea textarea-bordered"
              placeholder="Network segment description..."
              rows="2"
            ></textarea>
          </div>

          <div class="divider">Bridge Configuration</div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-semibold">🔌 Proxmox Bridge *</span>
              </label>
              <select v-model="config.bridge" class="select select-bordered">
                <option value="vmbr0">vmbr0 (Default)</option>
                <option value="vmbr1">vmbr1</option>
                <option value="vmbr2">vmbr2</option>
                <option value="vmbr3">vmbr3</option>
                <option value="vmbr4">vmbr4</option>
                <option value="vmbr5">vmbr5</option>
              </select>
              <label class="label">
                <span class="label-text-alt">Bridge must exist on Proxmox node</span>
              </label>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">🏷️ VLAN Tag</span>
              </label>
              <input
                v-model.number="config.vlan"
                type="number"
                class="input input-bordered"
                placeholder="Optional (1-4094)"
                min="1"
                max="4094"
              />
              <label class="label">
                <span class="label-text-alt">802.1Q VLAN ID (optional)</span>
              </label>
            </div>
          </div>

          <div class="divider">Network Addressing</div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">{{ t('configPanel.fields.cidr') }}</span>
              </label>
              <input
                v-model="config.cidr"
                type="text"
                class="input input-bordered"
                :placeholder="t('configPanel.placeholders.cidr')"
              />
              <label class="label">
                <span class="label-text-alt">For documentation/planning</span>
              </label>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">{{ t('configPanel.fields.gateway') }}</span>
              </label>
              <input
                v-model="config.gateway"
                type="text"
                class="input input-bordered"
                :placeholder="t('configPanel.placeholders.gateway')"
              />
              <label class="label">
                <span class="label-text-alt">For documentation/planning</span>
              </label>
            </div>
          </div>
        </template>

        <!-- Router Specific Fields -->
        <template v-if="node.type === 'router'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="config.description"
              class="textarea textarea-bordered"
              placeholder="Router description..."
              rows="2"
            ></textarea>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Appliance Type</span>
            </label>
            <select v-model="config.applianceType" class="select select-bordered">
              <option value="vyos">VyOS</option>
              <option value="opnsense">OPNsense</option>
              <option value="pfsense">pfSense</option>
            </select>
            <label class="label">
              <span class="label-text-alt">Virtual router appliance type</span>
            </label>
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

        <!-- Group/Container Specific Fields -->
        <template v-if="node.type === 'group'">
          <div class="alert alert-info mb-4">
            <span>📁 Groups organize related infrastructure components together.</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Prefix</span>
              </label>
              <input
                v-model="config.prefix"
                type="text"
                class="input input-bordered"
                placeholder="e.g., lab1, prod, dev"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Resource Pool</span>
              </label>
              <input
                v-model="config.resourcePool"
                type="text"
                class="input input-bordered"
                placeholder="Proxmox resource pool name"
              />
            </div>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="config.description"
              class="textarea textarea-bordered"
              placeholder="Describe this group..."
              rows="2"
            ></textarea>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Tags (comma-separated)</span>
            </label>
            <input
              v-model="config.tagsString"
              type="text"
              class="input input-bordered"
              placeholder="e.g., production, web-tier, database"
            />
          </div>
        </template>

        <!-- Simulated Internet Specific Fields -->
        <template v-if="node.type === 'simulated-internet'">
          <div class="alert alert-warning mb-4">
            <span>🌍 Simulated Internet provides fake public IPs and services for isolated training.</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Bridge Name *</span>
              </label>
              <input
                v-model="config.bridge"
                type="text"
                class="input input-bordered"
                placeholder="e.g., vmbr100"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Public CIDR *</span>
              </label>
              <input
                v-model="config.publicCidr"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 203.0.113.0/24"
              />
            </div>
          </div>

          <div class="form-control">
            <label class="cursor-pointer label">
              <span class="label-text">Include Fake DNS (8.8.8.8, 1.1.1.1)</span>
              <input v-model="config.fakeDns" type="checkbox" class="toggle toggle-primary" />
            </label>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Fake Services (comma-separated)</span>
            </label>
            <input
              v-model="config.fakeServices"
              type="text"
              class="input input-bordered"
              placeholder="e.g., cdn, updates, cloud"
            />
          </div>
        </template>

        <!-- Edge Firewall Specific Fields -->
        <template v-if="node.type === 'edge-firewall'">
          <div class="alert alert-success mb-4">
            <span>🛡️ Edge Firewall connects your network segments.</span>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="config.description"
              class="textarea textarea-bordered"
              placeholder="Edge firewall description..."
              rows="2"
            ></textarea>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Appliance Type</span>
            </label>
            <select v-model="config.applianceType" class="select select-bordered">
              <option value="pfsense">pfSense</option>
              <option value="opnsense">OPNsense</option>
            </select>
            <label class="label">
              <span class="label-text-alt">Firewall appliance type</span>
            </label>
          </div>
        </template>

        <!-- LXC Container Specific Fields -->
        <template v-if="node.type === 'lxc'">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Description</span>
            </label>
            <textarea
              v-model="config.description"
              class="textarea textarea-bordered"
              placeholder="Container description..."
              rows="2"
            ></textarea>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Hostname</span>
              </label>
              <input
                v-model="config.hostname"
                type="text"
                class="input input-bordered"
                placeholder="e.g., web-server-01"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">IP Address</span>
              </label>
              <input
                v-model="config.ipAddress"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 192.168.1.10"
              />
              <label class="label">
                <span class="label-text-alt">Static IP for this container</span>
              </label>
            </div>
          </div>
        </template>

        <!-- Vulnerable Target Specific Fields -->
        <template v-if="node.type === 'vuln-target'">
          <div class="alert alert-error mb-4">
            <span>🎯 Vulnerable targets are intentionally insecure systems for training purposes.</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Target Type *</span>
              </label>
              <select v-model="config.targetType" class="select select-bordered">
                <option value="">Select target...</option>
                <option value="dvwa">DVWA (Web Vulnerabilities)</option>
                <option value="juiceshop">OWASP Juice Shop</option>
                <option value="metasploitable">Metasploitable 2/3</option>
                <option value="dvl">Damn Vulnerable Linux</option>
                <option value="dvcp">Damn Vulnerable Cloud Platform</option>
                <option value="dvad">Damn Vulnerable AD</option>
                <option value="custom">Custom Template</option>
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Template Name</span>
              </label>
              <input
                v-model="config.template"
                type="text"
                class="input input-bordered"
                placeholder="Template to clone from"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">CPU Cores</span>
              </label>
              <input
                v-model.number="config.cores"
                type="number"
                class="input input-bordered"
                placeholder="2"
                min="1"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Memory (MB)</span>
              </label>
              <input
                v-model.number="config.memory"
                type="number"
                class="input input-bordered"
                placeholder="2048"
                min="512"
              />
            </div>
          </div>
        </template>

        <!-- Shared Service Specific Fields -->
        <template v-if="node.type === 'shared-service'">
          <div class="alert alert-info mb-4">
            <span>🔧 Shared services are accessible from all Gamenets (Git, Chat, Wiki, Auth).</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Service Type *</span>
              </label>
              <select v-model="config.serviceType" class="select select-bordered">
                <option value="">Select service...</option>
                <option value="gitea">Gitea (Git Server)</option>
                <option value="gitlab">GitLab</option>
                <option value="mattermost">Mattermost (Chat)</option>
                <option value="wiki">Wiki.js</option>
                <option value="keycloak">Keycloak (SSO)</option>
                <option value="registry">Docker Registry</option>
                <option value="vault">HashiCorp Vault</option>
                <option value="custom">Custom Service</option>
              </select>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Template Name</span>
              </label>
              <input
                v-model="config.template"
                type="text"
                class="input input-bordered"
                placeholder="Template to clone from"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">CPU Cores</span>
              </label>
              <input
                v-model.number="config.cores"
                type="number"
                class="input input-bordered"
                placeholder="2"
                min="1"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Memory (MB)</span>
              </label>
              <input
                v-model.number="config.memory"
                type="number"
                class="input input-bordered"
                placeholder="2048"
                min="512"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Network Bridge</span>
              </label>
              <input
                v-model="config.bridge"
                type="text"
                class="input input-bordered"
                placeholder="vmbr0 (management network)"
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">IP Address</span>
              </label>
              <input
                v-model="config.ipAddress"
                type="text"
                class="input input-bordered"
                placeholder="e.g., 10.0.0.10"
              />
            </div>
          </div>
        </template>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <div class="flex justify-between items-center w-full">
          <div class="flex items-center gap-4">
            <button class="btn btn-error btn-outline btn-sm" @click="handleDelete">
              🗑️ Delete
            </button>
            <span class="text-sm" :class="isValid ? 'text-success' : 'text-warning'">
              {{ isValid ? t('configPanel.status.valid') : t('configPanel.status.missing') }}
            </span>
          </div>
          <div class="space-x-2">
            <button class="btn btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" @click="handleSave">{{ t('configPanel.save') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
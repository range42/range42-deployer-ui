<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import FormField from '@/components/ui/FormField.vue'
import FormSection from '@/components/ui/FormSection.vue'
import FormDivider from '@/components/ui/FormDivider.vue'
import FormList from '@/components/ui/FormList.vue'
import { getBaseUrl } from '@/services/proxmox/api'
import { proxmoxApi } from '@/services/proxmox'
import { proxmoxCache } from '@/services/proxmox/cache'

const { t } = useI18n({ useScope: 'global' })

const props = defineProps(['node'])
const emit = defineEmits(['close', 'update', 'delete'])


const errors = ref([])
const isLoading = ref(false)
const loadingTemplates = ref(false)
const availableTemplates = ref([])
const availableStorages = ref([])
const availableIsos = ref([])

const config = ref({})

function getProxmoxNode() {
  const stored = JSON.parse(localStorage.getItem('range42_proxmox_settings') || '{}')
  return stored.defaultNode || 'pve01'
}

async function loadTemplates(force = false) {
  if (!getBaseUrl()) return
  loadingTemplates.value = true
  try {
    await proxmoxCache.fetchVms(getProxmoxNode(), force)
    availableTemplates.value = proxmoxCache.getTemplateOptions()

    // Also fetch storages
    try {
      const storages = await proxmoxApi.storage.list(getProxmoxNode())
      if (Array.isArray(storages)) {
        const items = Array.isArray(storages[0]) ? storages[0] : storages
        availableStorages.value = items
          .filter((s) => s.storage_active || s.active)
          .map((s) => ({
            value: s.storage_name || s.storage || s.name,
            label: `${s.storage_name || s.storage || s.name} (${s.storage_type || s.type || '?'})`,
          }))
      }
    } catch { /* storage listing optional */ }
  } catch (e) {
    console.warn('[ConfigPanel] Failed to fetch templates:', e)
  } finally {
    loadingTemplates.value = false
  }
}

// Auto-fill cores/memory/disk when template selection changes
watch(() => config.value.template, (newTemplate) => {
  if (!newTemplate) return
  const templateVm = proxmoxCache.templates.value.find(t => String(t.vmid) === newTemplate)
  if (templateVm) {
    config.value.cores = templateVm.maxcpu || config.value.cores
    config.value.memory = templateVm.maxmem ? Math.floor(templateVm.maxmem / 1024 / 1024) : config.value.memory
  }
})

onMounted(async () => {
  if (props.node?.data?.config) {
    config.value = { ...props.node.data.config }
  }

  if (props.node?.type === 'vm' && !props.node?.data?.deployed) {
    await loadTemplates()
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
      if (!String(config.value.memory || '').trim()) {
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

// Add firewall rule management (Proxmox-compatible format)
const addFirewallRule = () => {
  if (!config.value.rules) config.value.rules = []
  config.value.rules.push({
    action: 'ACCEPT',
    direction: 'in',
    source: '',
    dest: '',
    dport: '',
    proto: 'tcp',
    comment: '',
    enabled: true
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
  emit('update', props.node.id, {
    config: config.value,
    status: newStatus,
    label: config.value.name || props.node.data?.label,
  })
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
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center" :class="node.data?.deployed ? 'bg-primary/10' : 'bg-base-200'">
            <span class="text-xl">{{ node.type === 'vm' ? '🖥️' : node.type === 'lxc' ? '📦' : node.type === 'network-segment' ? '🔗' : node.type === 'router' ? '🔀' : '⚙️' }}</span>
          </div>
          <div>
            <h3 class="text-xl font-bold">{{ config.name || node.type.replace('-', ' ') }}</h3>
            <p class="text-xs text-base-content/50 uppercase tracking-wider">{{ node.data?.deployed ? 'Deployed' : 'Design' }} · {{ node.type.replace('-', ' ') }}</p>
          </div>
        </div>
        <button class="btn btn-sm btn-circle btn-ghost" @click="emit('close')">✕</button>
      </div>

      <!-- Content -->
      <div class="space-y-6">
        <!-- Common Fields -->
        <FormSection icon="" title="" :columns="1">
          <FormField
            v-model="config.name"
            :label="t('configPanel.fields.name')"
            type="text"
            :placeholder="t('configPanel.placeholders.name', { type: node.type.replace('-', ' ') })"
            :required="true"
            icon=""
          />
        </FormSection>

        <!-- Deployed VM Status View -->
        <template v-if="node.type === 'vm' && node.data?.deployed">
          <!-- Status Banner -->
          <div class="flex items-center gap-3 px-4 py-3 rounded-lg border"
            :class="node.data.status === 'running'
              ? 'bg-success/5 border-success/20 text-success'
              : node.data.status === 'stopped'
                ? 'bg-base-200 border-base-300 text-base-content/50'
                : 'bg-warning/5 border-warning/20 text-warning'"
          >
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
              :class="node.data.status === 'running'
                ? 'bg-success shadow-[0_0_8px_theme(colors.success)]'
                : node.data.status === 'stopped'
                  ? 'bg-base-content/20'
                  : 'bg-warning animate-pulse'"
            ></div>
            <span class="font-semibold text-sm uppercase tracking-wider">{{ node.data.status }}</span>
            <div class="ml-auto flex items-center gap-2">
              <span class="badge badge-sm badge-outline">VMID {{ config.vmid }}</span>
              <span v-if="config.proxmoxNode" class="badge badge-sm badge-ghost">{{ config.proxmoxNode }}</span>
            </div>
          </div>

          <!-- Info Table -->
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <td class="text-base-content/50 w-32">Hostname</td>
                  <td class="font-medium">{{ config.name }}</td>
                </tr>
                <tr>
                  <td class="text-base-content/50">VMID</td>
                  <td class="font-mono">{{ config.vmid }}</td>
                </tr>
                <tr>
                  <td class="text-base-content/50">Node</td>
                  <td>{{ config.proxmoxNode || '—' }}</td>
                </tr>
                <tr>
                  <td class="text-base-content/50">Uptime</td>
                  <td>{{ config.uptime ? Math.floor(config.uptime / 3600) + 'h ' + Math.floor((config.uptime % 3600) / 60) + 'm' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Resource Cards -->
          <div class="grid grid-cols-3 gap-3">
            <!-- CPU -->
            <div class="rounded-lg border border-base-300 p-3">
              <div class="text-[11px] text-base-content/50 uppercase tracking-wider mb-1">CPU</div>
              <div class="text-xl font-bold">{{ config.cores }}<span class="text-sm font-normal text-base-content/40 ml-1">cores</span></div>
              <progress class="progress progress-primary w-full mt-2 h-1.5" :value="Math.round((config.cpuUsage || 0) * 100)" max="100"></progress>
              <div class="text-[10px] text-base-content/50 mt-0.5">{{ Math.round((config.cpuUsage || 0) * 100) }}% utilization</div>
            </div>

            <!-- RAM -->
            <div class="rounded-lg border border-base-300 p-3">
              <div class="text-[11px] text-base-content/50 uppercase tracking-wider mb-1">Memory</div>
              <div class="text-xl font-bold">
                {{ parseInt(config.memory) >= 1024 ? (parseInt(config.memory) / 1024).toFixed(1) : config.memory }}
                <span class="text-sm font-normal text-base-content/40 ml-1">{{ parseInt(config.memory) >= 1024 ? 'GB' : 'MB' }}</span>
              </div>
              <progress class="progress progress-secondary w-full mt-2 h-1.5" :value="config.memUsed || 0" :max="parseInt(config.memory) || 1"></progress>
              <div class="text-[10px] text-base-content/50 mt-0.5">
                {{ config.memUsed ? (config.memUsed >= 1024 ? (config.memUsed / 1024).toFixed(1) + ' GB' : config.memUsed + ' MB') : '0' }} used
              </div>
            </div>

            <!-- Disk -->
            <div class="rounded-lg border border-base-300 p-3">
              <div class="text-[11px] text-base-content/50 uppercase tracking-wider mb-1">Disk</div>
              <div class="text-xl font-bold">
                {{ config.diskMax ? (config.diskMax / 1024 / 1024 / 1024).toFixed(0) : '—' }}
                <span class="text-sm font-normal text-base-content/40 ml-1">GB</span>
              </div>
              <div class="text-[10px] text-base-content/50 mt-2">Provisioned</div>
            </div>
          </div>
        </template>

        <!-- VM Specific Fields (non-deployed) -->
        <template v-else-if="node.type === 'vm'">
          <FormDivider label="Virtual Machine" icon="" />

          <FormSection title="Template" icon="" variant="bordered" :columns="1">
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <FormField
                  v-model="config.template"
                  label="Clone from template"
                  type="select"
                  :options="availableTemplates"
                  :placeholder="loadingTemplates ? 'Loading templates...' : 'Select a template...'"
                  :disabled="loadingTemplates"
                  hint="Selecting a template auto-fills CPU and RAM (editable)"
                  icon=""
                />
              </div>
              <button
                class="btn btn-sm btn-ghost mb-1"
                :class="{ 'loading': loadingTemplates }"
                :disabled="loadingTemplates"
                @click="loadTemplates(true)"
                title="Refresh templates from Proxmox"
              >
                <svg v-if="!loadingTemplates" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </FormSection>

          <FormSection title="Resources" icon="" variant="bordered" :columns="3">
            <FormField
              v-model="config.cores"
              label="CPU Cores"
              type="number"
              placeholder="2"
              :min="1"
              :max="32"
              icon=""
            />
            <FormField
              v-model="config.memory"
              label="Memory (MB)"
              type="number"
              placeholder="2048"
              :min="512"
              hint="Auto-filled from template"
              icon=""
            />
            <FormField
              v-model="config.diskSize"
              label="Disk"
              type="text"
              placeholder="32G"
              hint="e.g. 16G, 32G, 100G"
              icon=""
            />
          </FormSection>

          <FormSection v-if="availableStorages.length > 0" title="Storage" icon="" variant="bordered" :columns="1">
            <FormField
              v-model="config.storage"
              label="Disk Storage"
              type="select"
              :options="availableStorages"
              placeholder="Use project default"
              hint="Where to store VM disk (overrides project default)"
              icon=""
            />
          </FormSection>

          <FormSection title="Network & Details" icon="" variant="bordered" :columns="2">
            <FormField
              v-model="config.ipAddress"
              label="IP Address (optional)"
              type="text"
              placeholder="auto-assign or e.g. 192.168.42.50"
              hint="Leave empty for DHCP or cloud-init default"
              icon=""
            />
            <FormField
              v-model="config.description"
              label="Description"
              type="textarea"
              placeholder="What is this VM for?"
              :rows="2"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Network Segment Specific Fields -->
        <template v-if="node.type === 'network-segment'">
          <FormDivider label="Segment Type" icon="" />
          
          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.segmentType"
              label="Network Zone Type"
              type="select"
              :required="true"
              :options="[
                { value: 'wan', label: '🌐 WAN - External/Internet facing' },
                { value: 'dmz', label: '🛡️ DMZ - Demilitarized zone' },
                { value: 'lan', label: '🏢 LAN - Internal network' },
                { value: 'management', label: '🔧 Management - Admin/OOB access' },
                { value: 'custom', label: '⚙️ Custom - User defined' }
              ]"
              hint="Defines the security zone purpose"
              icon=""
            />
            <FormField
              v-model="config.description"
              label="Description"
              type="textarea"
              placeholder="Network segment description..."
              :rows="2"
              icon=""
            />
          </FormSection>

          <FormDivider label="Proxmox Bridge Configuration" icon="" />

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.bridge"
              label="Proxmox Bridge"
              type="text"
              :required="true"
              placeholder="vmbr0"
              hint="Bridge name (must exist on Proxmox node)"
              icon=""
            />
            <FormField
              v-model="config.vlan"
              label="VLAN Tag"
              type="number"
              placeholder="Optional (1-4094)"
              :min="1"
              :max="4094"
              hint="802.1Q VLAN ID (optional)"
              icon=""
            />
          </FormSection>

          <FormDivider label="IP Addressing (Planning)" icon="" />

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.cidr"
              :label="t('configPanel.fields.cidr')"
              type="text"
              :placeholder="t('configPanel.placeholders.cidr')"
              hint="Network range in CIDR notation"
              icon=""
            />
            <FormField
              v-model="config.gateway"
              :label="t('configPanel.fields.gateway')"
              type="text"
              :placeholder="t('configPanel.placeholders.gateway')"
              hint="Default gateway IP for this segment"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Router Specific Fields -->
        <template v-if="node.type === 'router'">
          <FormDivider label="Router Configuration" icon="" />
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.description"
              label="Description"
              type="textarea"
              placeholder="Router description..."
              :rows="2"
              icon=""
            />
            <FormField
              v-model="config.applianceType"
              label="Appliance Type"
              type="select"
              :options="[
                { value: 'vyos', label: 'VyOS' },
                { value: 'opnsense', label: 'OPNsense' },
                { value: 'pfsense', label: 'pfSense' }
              ]"
              hint="Virtual router appliance type"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Switch Specific Fields -->
        <template v-if="node.type === 'switch'">
          <FormDivider label="Switch Configuration" icon="" />
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.bridge"
              label="Backing Proxmox Bridge"
              type="select"
              :options="[
                { value: '', label: 'None (Logical only)' },
                { value: 'vmbr0', label: 'vmbr0' },
                { value: 'vmbr1', label: 'vmbr1' },
                { value: 'vmbr2', label: 'vmbr2' },
                { value: 'vmbr3', label: 'vmbr3' }
              ]"
              hint="Optional bridge for VLAN trunking"
              icon=""
            />
            <FormField
              v-model="config.portCount"
              label="Port Count"
              type="select"
              :required="true"
              :options="[
                { value: 8, label: '8 ports' },
                { value: 16, label: '16 ports' },
                { value: 24, label: '24 ports' },
                { value: 48, label: '48 ports' }
              ]"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.managementVlan"
              label="Management VLAN"
              type="number"
              placeholder="e.g., 1"
              :min="1"
              :max="4094"
              icon=""
            />
            <FormField
              v-model="config.trunkPortsInput"
              label="Trunk Ports"
              type="text"
              placeholder="e.g., 1,2,24"
              hint="Comma-separated list of trunk ports"
              icon=""
            />
          </FormSection>

          <!-- VLAN Management -->
          <FormDivider label="VLAN Configuration" icon="" />
          
          <FormList
            :items="config.vlans || []"
            add-label="Add VLAN"
            empty-text="No VLANs configured"
            empty-hint="Click 'Add VLAN' to create one"
            @add="addVlan"
            @remove="removeVlan"
          >
            <template #header>
              <span class="font-medium text-sm">VLANs</span>
            </template>
            <template #item="{ item: vlan }">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pr-8">
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">VLAN ID</span></label>
                  <input
                    v-model.number="vlan.id"
                    type="number"
                    class="input input-bordered input-sm"
                    placeholder="1-4094"
                    min="1"
                    max="4094"
                  />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Name</span></label>
                  <input
                    v-model="vlan.name"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="VLAN Name"
                  />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Subnet</span></label>
                  <input
                    v-model="vlan.subnet"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="10.0.10.0/24"
                  />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Gateway</span></label>
                  <input
                    v-model="vlan.gateway"
                    type="text"
                    class="input input-bordered input-sm"
                    placeholder="10.0.10.1"
                  />
                </div>
              </div>
            </template>
          </FormList>
        </template>

        <!-- Firewall Specific Fields -->
        <template v-if="node.type === 'firewall'">
          <FormDivider label="Firewall Features" icon="" />
          
          <FormSection variant="bordered" :columns="3">
            <FormField
              v-model="config.natEnabled"
              label="Enable NAT"
              type="checkbox"
              icon=""
            />
            <FormField
              v-model="config.vpnSupport"
              label="VPN Support"
              type="checkbox"
              icon=""
            />
            <FormField
              v-model="config.intrusionDetection"
              label="Intrusion Detection"
              type="checkbox"
              icon=""
            />
          </FormSection>

          <!-- Enhanced Firewall Rules Builder -->
          <FormDivider label="Firewall Rules" icon="" />
          
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-medium text-sm">Rules</span>
              <button type="button" @click="addFirewallRule" class="btn btn-sm btn-primary gap-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                Add Rule
              </button>
            </div>
            
            <!-- Rules Header -->
            <div v-if="config.rules?.length" class="hidden md:grid grid-cols-12 gap-2 px-4 py-2 bg-base-200/70 rounded-lg text-xs font-semibold text-base-content/60">
              <div class="col-span-1">#</div>
              <div class="col-span-1">Action</div>
              <div class="col-span-1">Dir</div>
              <div class="col-span-2">Source</div>
              <div class="col-span-2">Destination</div>
              <div class="col-span-1">Port</div>
              <div class="col-span-1">Proto</div>
              <div class="col-span-2">Comment</div>
              <div class="col-span-1"></div>
            </div>

            <TransitionGroup
              v-if="config.rules?.length"
              tag="div"
              class="space-y-2"
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="opacity-0 scale-95"
              enter-to-class="opacity-100 scale-100"
              leave-active-class="transition-all duration-150 ease-in"
              leave-from-class="opacity-100 scale-100"
              leave-to-class="opacity-0 scale-95"
            >
              <div
                v-for="(rule, index) in config.rules"
                :key="rule.id || index"
                class="group bg-base-200/30 border border-base-300 rounded-lg p-3 hover:border-primary/30 transition-all duration-200"
                :class="{ 'opacity-40 bg-base-300/20': rule.enabled === false }"
              >
                <!-- Rule Row -->
                <div class="grid grid-cols-2 md:grid-cols-12 gap-2 items-center">
                  <!-- Position -->
                  <div class="hidden md:flex col-span-1 text-sm font-mono text-base-content/40">
                    {{ index + 1 }}
                  </div>
                  
                  <!-- Action -->
                  <select 
                    v-model="rule.action" 
                    class="select select-bordered select-sm col-span-1 font-medium"
                    :class="{
                      'bg-success/10 border-success/30 text-success': rule.action === 'ACCEPT',
                      'bg-error/10 border-error/30 text-error': rule.action === 'DROP' || rule.action === 'REJECT'
                    }"
                  >
                    <option value="ACCEPT">Allow</option>
                    <option value="DROP">Drop</option>
                    <option value="REJECT">Reject</option>
                  </select>
                  
                  <!-- Direction -->
                  <select v-model="rule.direction" class="select select-bordered select-sm col-span-1">
                    <option value="in">In</option>
                    <option value="out">Out</option>
                  </select>
                  
                  <!-- Source -->
                  <input
                    v-model="rule.source"
                    type="text"
                    class="input input-bordered input-sm col-span-2 focus:input-primary"
                    placeholder="any / CIDR"
                  />
                  
                  <!-- Destination -->
                  <input
                    v-model="rule.dest"
                    type="text"
                    class="input input-bordered input-sm col-span-2 focus:input-primary"
                    placeholder="any / CIDR"
                  />
                  
                  <!-- Port -->
                  <input
                    v-model="rule.dport"
                    type="text"
                    class="input input-bordered input-sm col-span-1 focus:input-primary"
                    placeholder="80,443"
                  />
                  
                  <!-- Protocol -->
                  <select v-model="rule.proto" class="select select-bordered select-sm col-span-1">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="icmp">ICMP</option>
                    <option value="">Any</option>
                  </select>
                  
                  <!-- Comment -->
                  <input
                    v-model="rule.comment"
                    type="text"
                    class="input input-bordered input-sm col-span-2 focus:input-primary"
                    placeholder="Description"
                  />
                  
                  <!-- Actions -->
                  <div class="col-span-1 flex gap-1 justify-end">
                    <label class="swap swap-rotate">
                      <input type="checkbox" v-model="rule.enabled" />
                      <svg class="swap-on w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                      <svg class="swap-off w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </label>
                    <button
                      type="button"
                      @click="removeFirewallRule(index)"
                      class="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </TransitionGroup>

            <!-- Empty State -->
            <div v-else class="text-center py-8 border-2 border-dashed border-base-300 rounded-lg bg-base-200/30">
              <svg class="w-12 h-12 mx-auto mb-3 text-base-content/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <p class="text-base-content/50">No firewall rules configured</p>
              <p class="text-sm text-base-content/30 mt-1">Click "Add Rule" to create your first rule</p>
            </div>
          </div>
        </template>

        <!-- Load Balancer Specific Fields -->
        <template v-if="node.type === 'loadbalancer'">
          <FormDivider label="Load Balancer Settings" icon="" />
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.algorithm"
              label="Load Balancing Algorithm"
              type="select"
              :required="true"
              :options="[
                { value: 'round-robin', label: 'Round Robin' },
                { value: 'least-connections', label: 'Least Connections' },
                { value: 'ip-hash', label: 'IP Hash' },
                { value: 'weighted-round-robin', label: 'Weighted Round Robin' }
              ]"
              icon=""
            />
            <FormField
              v-model="config.healthCheck"
              label="Health Check"
              type="checkbox"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.sslTermination"
              label="SSL Termination"
              type="checkbox"
              icon=""
            />
          </FormSection>

          <!-- Server Pool Management -->
          <FormDivider label="Server Pool" icon="" />
          
          <FormList
            :items="config.servers || []"
            add-label="Add Server"
            empty-text="No servers configured"
            empty-hint="Click 'Add Server' to add backend servers"
            @add="addServer"
            @remove="removeServer"
          >
            <template #header>
              <span class="font-medium text-sm">Backend Servers</span>
            </template>
            <template #item="{ item: server }">
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pr-8">
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Server IP</span></label>
                  <input v-model="server.ip" type="text" class="input input-bordered input-sm" placeholder="192.168.1.10" />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Port</span></label>
                  <input v-model="server.port" type="text" class="input input-bordered input-sm" placeholder="80" />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Weight</span></label>
                  <input v-model.number="server.weight" type="number" class="input input-bordered input-sm" placeholder="1" min="1" />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Status</span></label>
                  <select v-model="server.status" class="select select-bordered select-sm">
                    <option value="active">Active</option>
                    <option value="backup">Backup</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>
            </template>
          </FormList>
        </template>

        <!-- DNS Server Specific Fields -->
        <template v-if="node.type === 'dns'">
          <FormDivider label="DNS Server Settings" icon="" />
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.recursion"
              label="Enable Recursion"
              type="checkbox"
              icon=""
            />
            <FormField
              v-model="config.dnssec"
              label="DNSSEC"
              type="checkbox"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.forwarders"
              label="Forwarders"
              type="text"
              placeholder="8.8.8.8, 1.1.1.1"
              hint="Comma-separated list of upstream DNS servers"
              icon=""
            />
          </FormSection>

          <!-- DNS Zone Management -->
          <FormDivider label="DNS Zones" icon="" />
          
          <FormList
            :items="config.zones || []"
            add-label="Add Zone"
            empty-text="No DNS zones configured"
            empty-hint="Click 'Add Zone' to create a DNS zone"
            @add="addDnsZone"
            @remove="removeDnsZone"
          >
            <template #header>
              <span class="font-medium text-sm">Zones</span>
            </template>
            <template #item="{ item: zone }">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pr-8">
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Zone Name</span></label>
                  <input v-model="zone.name" type="text" class="input input-bordered input-sm" placeholder="example.com" />
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Type</span></label>
                  <select v-model="zone.type" class="select select-bordered select-sm">
                    <option value="forward">Forward</option>
                    <option value="reverse">Reverse</option>
                  </select>
                </div>
                <div class="form-control">
                  <label class="label py-0"><span class="label-text text-xs opacity-60">Description</span></label>
                  <input v-model="zone.description" type="text" class="input input-bordered input-sm" placeholder="Zone description" />
                </div>
              </div>
            </template>
          </FormList>
        </template>

        <!-- DHCP Server Specific Fields -->
        <template v-if="node.type === 'dhcp'">
          <FormDivider label="DHCP Server Settings" icon="" />
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.scope"
              label="IP Range/Scope"
              type="text"
              :required="true"
              placeholder="e.g., 192.168.1.100-200"
              hint="Range of IPs to assign to clients"
              icon=""
            />
            <FormField
              v-model="config.leaseTime"
              label="Lease Time"
              type="text"
              placeholder="e.g., 24h, 7d"
              hint="How long clients can use assigned IPs"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.gateway"
              label="Default Gateway"
              type="text"
              :required="true"
              placeholder="e.g., 192.168.1.1"
              icon=""
            />
            <FormField
              v-model="config.dnsServers"
              label="DNS Servers"
              type="text"
              placeholder="e.g., 192.168.1.1, 8.8.8.8"
              hint="Comma-separated list of DNS servers"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Docker Container Specific Fields -->
        <template v-if="node.type === 'docker'">
          <FormDivider label="Docker Container" icon="" />
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.image"
              label="Docker Image"
              type="text"
              :required="true"
              placeholder="e.g., nginx:latest"
              hint="Image name with optional tag"
              icon=""
            />
            <FormField
              v-model="config.ports"
              label="Port Mapping"
              type="text"
              :required="true"
              placeholder="e.g., 80:80, 443:443"
              hint="host:container format, comma-separated"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.env"
              label="Environment Variables"
              type="textarea"
              placeholder="KEY=value (one per line)"
              :rows="3"
              icon=""
            />
            <FormField
              v-model="config.network"
              label="Container Network"
              type="select"
              :options="[
                { value: 'bridge', label: 'Bridge (Default)' },
                { value: 'host', label: 'Host Network' },
                { value: 'none', label: 'No Network' },
                { value: 'custom', label: 'Custom Network' }
              ]"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Group/Container Specific Fields -->
        <template v-if="node.type === 'group'">
          <div class="alert alert-info shadow-sm mb-4">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span>Groups organize related infrastructure components together.</span>
          </div>
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.prefix"
              label="Prefix"
              type="text"
              placeholder="e.g., lab1, prod, dev"
              hint="Applied to all items in this group"
              icon=""
            />
            <FormField
              v-model="config.resourcePool"
              label="Resource Pool"
              type="text"
              placeholder="Proxmox resource pool name"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.description"
              label="Description"
              type="textarea"
              placeholder="Describe this group..."
              :rows="2"
              icon=""
            />
            <FormField
              v-model="config.tagsString"
              label="Tags"
              type="text"
              placeholder="e.g., production, web-tier, database"
              hint="Comma-separated list of tags"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Simulated Internet Specific Fields -->
        <template v-if="node.type === 'simulated-internet'">
          <div class="alert alert-warning shadow-sm mb-4">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Simulated Internet provides fake public IPs and services for isolated training.</span>
          </div>
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.bridge"
              label="Bridge Name"
              type="text"
              :required="true"
              placeholder="e.g., vmbr100"
              icon=""
            />
            <FormField
              v-model="config.publicCidr"
              label="Public CIDR"
              type="text"
              :required="true"
              placeholder="e.g., 203.0.113.0/24"
              hint="Simulated public IP range"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.fakeDns"
              label="Include Fake DNS (8.8.8.8, 1.1.1.1)"
              type="checkbox"
              icon=""
            />
            <FormField
              v-model="config.fakeServices"
              label="Fake Services"
              type="text"
              placeholder="e.g., cdn, updates, cloud"
              hint="Comma-separated list of simulated services"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Edge Firewall Specific Fields -->
        <template v-if="node.type === 'edge-firewall'">
          <div class="alert alert-success shadow-sm mb-4">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Edge Firewall connects your network segments.</span>
          </div>

          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.description"
              label="Description"
              type="textarea"
              placeholder="Edge firewall description..."
              :rows="2"
              icon=""
            />
            <FormField
              v-model="config.applianceType"
              label="Appliance Type"
              type="select"
              :options="[
                { value: 'pfsense', label: 'pfSense' },
                { value: 'opnsense', label: 'OPNsense' }
              ]"
              hint="Firewall appliance type"
              icon=""
            />
          </FormSection>
        </template>

        <!-- LXC Container Specific Fields -->
        <template v-if="node.type === 'lxc'">
          <FormDivider label="LXC Container" icon="" />
          
          <FormSection variant="bordered" :columns="1">
            <FormField
              v-model="config.description"
              label="Description"
              type="textarea"
              placeholder="Container description..."
              :rows="2"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.hostname"
              label="Hostname"
              type="text"
              placeholder="e.g., web-server-01"
              icon=""
            />
            <FormField
              v-model="config.ipAddress"
              label="IP Address"
              type="text"
              placeholder="e.g., 192.168.1.10"
              hint="Static IP for this container"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Vulnerable Target Specific Fields -->
        <template v-if="node.type === 'vuln-target'">
          <div class="alert alert-error shadow-sm mb-4">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Vulnerable targets are intentionally insecure systems for training purposes.</span>
          </div>
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.targetType"
              label="Target Type"
              type="select"
              :required="true"
              placeholder="Select target..."
              :options="[
                { value: 'dvwa', label: 'DVWA (Web Vulnerabilities)' },
                { value: 'juiceshop', label: 'OWASP Juice Shop' },
                { value: 'metasploitable', label: 'Metasploitable 2/3' },
                { value: 'dvl', label: 'Damn Vulnerable Linux' },
                { value: 'dvcp', label: 'Damn Vulnerable Cloud Platform' },
                { value: 'dvad', label: 'Damn Vulnerable AD' },
                { value: 'custom', label: 'Custom Template' }
              ]"
              icon=""
            />
            <FormField
              v-model="config.template"
              label="Template Name"
              type="text"
              placeholder="Template to clone from"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.cores"
              label="CPU Cores"
              type="number"
              placeholder="2"
              :min="1"
              icon=""
            />
            <FormField
              v-model="config.memory"
              label="Memory (MB)"
              type="number"
              placeholder="2048"
              :min="512"
              icon=""
            />
          </FormSection>
        </template>

        <!-- Shared Service Specific Fields -->
        <template v-if="node.type === 'shared-service'">
          <div class="alert alert-info shadow-sm mb-4">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Shared services are accessible from all Gamenets (Git, Chat, Wiki, Auth).</span>
          </div>
          
          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.serviceType"
              label="Service Type"
              type="select"
              :required="true"
              placeholder="Select service..."
              :options="[
                { value: 'gitea', label: 'Gitea (Git Server)' },
                { value: 'gitlab', label: 'GitLab' },
                { value: 'mattermost', label: 'Mattermost (Chat)' },
                { value: 'wiki', label: 'Wiki.js' },
                { value: 'keycloak', label: 'Keycloak (SSO)' },
                { value: 'registry', label: 'Docker Registry' },
                { value: 'vault', label: 'HashiCorp Vault' },
                { value: 'custom', label: 'Custom Service' }
              ]"
              icon=""
            />
            <FormField
              v-model="config.template"
              label="Template Name"
              type="text"
              placeholder="Template to clone from"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.cores"
              label="CPU Cores"
              type="number"
              placeholder="2"
              :min="1"
              icon=""
            />
            <FormField
              v-model="config.memory"
              label="Memory (MB)"
              type="number"
              placeholder="2048"
              :min="512"
              icon=""
            />
          </FormSection>

          <FormSection variant="bordered" :columns="2">
            <FormField
              v-model="config.bridge"
              label="Network Bridge"
              type="text"
              placeholder="vmbr0 (management network)"
              icon=""
            />
            <FormField
              v-model="config.ipAddress"
              label="IP Address"
              type="text"
              placeholder="e.g., 10.0.0.10"
              icon=""
            />
          </FormSection>
        </template>
      </div>

      <!-- Actions -->
      <div class="modal-action border-t border-base-300 pt-4 mt-6">
        <div class="flex justify-between items-center w-full">
          <div class="flex items-center gap-3">
            <button class="btn btn-error btn-outline btn-sm gap-1" @click="handleDelete">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
            <div v-if="!node.data?.deployed" class="flex items-center gap-2 px-3 py-1.5 rounded-lg" :class="isValid ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'">
              <svg v-if="isValid" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span class="text-sm font-medium">
                {{ isValid ? t('configPanel.status.valid') : t('configPanel.status.missing') }}
              </span>
            </div>
          </div>
          <div v-if="!node.data?.deployed" class="flex gap-2">
            <button class="btn btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary gap-1" @click="handleSave">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              {{ t('configPanel.save') }}
            </button>
          </div>
          <button v-else class="btn btn-ghost" @click="emit('close')">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>
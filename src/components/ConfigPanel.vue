<script setup>
import { ref, computed, watch, onMounted, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import FormField from '@/components/ui/FormField.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import FormSection from '@/components/ui/FormSection.vue'
import NetworkFields from '@/components/ConfigPanel/NetworkFields.vue'
import RouterFields from '@/components/ConfigPanel/RouterFields.vue'
import SwitchFields from '@/components/ConfigPanel/SwitchFields.vue'
import FirewallFields from '@/components/ConfigPanel/FirewallFields.vue'
import LoadBalancerFields from '@/components/ConfigPanel/LoadBalancerFields.vue'
import DnsFields from '@/components/ConfigPanel/DnsFields.vue'
import DhcpFields from '@/components/ConfigPanel/DhcpFields.vue'
import DockerFields from '@/components/ConfigPanel/DockerFields.vue'
import GroupFields from '@/components/ConfigPanel/GroupFields.vue'
import SimulatedInternetFields from '@/components/ConfigPanel/SimulatedInternetFields.vue'
import EdgeFirewallFields from '@/components/ConfigPanel/EdgeFirewallFields.vue'
import LxcFields from '@/components/ConfigPanel/LxcFields.vue'
import VulnerableTargetFields from '@/components/ConfigPanel/VulnerableTargetFields.vue'
import SharedServiceFields from '@/components/ConfigPanel/SharedServiceFields.vue'
import VmFields from '@/components/ConfigPanel/VmFields.vue'
import NodeContextNotice from '@/components/ConfigPanel/NodeContextNotice.vue'
import DeployedVmFields from '@/components/ConfigPanel/DeployedVmFields.vue'
import { getBaseUrl } from '@/services/proxmox/api'
import { proxmoxApi } from '@/services/proxmox'
import { proxmoxCache } from '@/services/proxmox/cache'
import { PREDEFINED_TAGS, getTagColor } from '@/constants/tags'
import { useTagSync } from '@/composables/useTagSync'
import { usePendingChanges } from '@/composables/usePendingChanges'
import ApplyChangesDialog from '@/components/ApplyChangesDialog.vue'
import DeleteNodeModal from '@/components/DeleteNodeModal.vue'
import { useProxmoxTasks } from '@/composables/useProxmoxTasks'
import NodeAttachmentsSection from '@/components/project/attachments/NodeAttachmentsSection.vue'
import { resolveNodeStatus } from '@/composables/useNodeStatus'

const { t } = useI18n({ useScope: 'global' })
const tasks = useProxmoxTasks()
const showDeleteModal = ref(false)

// Modal shell refs — focus is moved into the panel on open (mirrors
// ConfirmDialog's pattern) and Escape closes via the root keydown handler.
const modalBox = ref(null)
const titleId = 'config-panel-title'

const props = defineProps({
  node: {
    type: Object,
    default: null,
  },
  attachments: {
    type: Array,
    default: () => [],
  },
  nodes: {
    type: Array,
    default: () => [],
  },
})
const emit = defineEmits(['close', 'update', 'delete', 'update:attachments', 'open-content'])

const statusView = computed(() =>
  resolveNodeStatus(props.node?.data?.status, props.node?.data?.pendingAction),
)

// Maps the status dot color to its badge/dot Tailwind utility so the header
// pill and live-status dot stay visually in sync with the canvas legend.
const STATUS_DOT_CLASS = {
  green: 'bg-success',
  red: 'bg-error',
  orange: 'bg-warning',
  blue: 'bg-info',
  gray: 'bg-base-content/30',
}
const STATUS_BADGE_CLASS = {
  green: 'badge-success',
  red: 'badge-error',
  orange: 'badge-warning',
  blue: 'badge-info',
  gray: 'badge-ghost',
}
const statusDotClass = computed(() => STATUS_DOT_CLASS[statusView.value.dotColor] || STATUS_DOT_CLASS.gray)
const statusBadgeClass = computed(() => STATUS_BADGE_CLASS[statusView.value.dotColor] || STATUS_BADGE_CLASS.gray)

// Header type icon — kept identical to the prior inline ternary, just hoisted.
const typeIcon = computed(() => {
  switch (props.node?.type) {
    case 'vm': return 'monitor'
    case 'lxc': return 'cube'
    case 'network-segment': return 'link'
    case 'router': return 'router'
    default: return 'gear'
  }
})

const typeLabel = computed(() => (props.node?.type || '').replace('-', ' '))
const subtitleState = computed(() =>
  props.node?.data?.deployed ? t('configPanel.subtitle.deployed') : t('configPanel.subtitle.design'),
)


const errors = ref([])
const loadingTemplates = ref(false)
const availableTemplates = ref([])
const availableStorages = ref([])

const config = ref({})

// Injected from ProjectEditor — per-project API config
const apiConfig = inject('apiConfig', null)

function getProxmoxNode() {
  // Use per-project settings from injected apiConfig
  if (apiConfig?.node?.value) return apiConfig.node.value
  // Fallback to global settings
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
    config.value = JSON.parse(JSON.stringify(props.node.data.config))
  }
  // For group nodes, hydrate kind/team_count from data (spec §6)
  if (props.node?.type === 'group') {
    config.value.kind = props.node.data?.kind || 'topology_group'
    config.value.team_count = Number(props.node.data?.team_count ?? config.value.team_count ?? 1)
  }
  config.value.role = config.value.role ?? ''

  if (props.node?.type === 'vm' && !props.node?.data?.deployed) {
    await loadTemplates()
  }

  // Load i18n namespaces used by this panel
  ensureNamespaces(['configPanel', 'project', 'common'])

  // Move focus into the panel on open so keyboard/AT users land inside the
  // dialog (mirrors ConfirmDialog). The box is focusable via tabindex="-1".
  await nextTick()
  modalBox.value?.focus()
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
      if (!Number.isInteger(Number(config.value.cores ?? config.value.cpu)) || Number(config.value.cores ?? config.value.cpu) < 1) {
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


// Tag editor state
const tagSync = useTagSync()
const tagInput = ref('')
const showTagDropdown = ref(false)

const filteredPredefinedTags = computed(() => {
  const currentTags = props.node?.data?.tags || []
  const search = tagInput.value.toLowerCase()
  return PREDEFINED_TAGS.filter(t =>
    !currentTags.includes(t.name) &&
    (search === '' || t.name.includes(search))
  )
})

function addTag() {
  const tag = tagInput.value.trim().toLowerCase()
  if (!tag || !props.node) return

  if (props.node.data.deployed && props.node.data.desiredConfig) {
    const currentTags = props.node.data.desiredConfig.tags || []
    if (currentTags.includes(tag)) return
    props.node.data.desiredConfig.tags = [...currentTags, tag] // eslint-disable-line vue/no-mutating-props -- VueFlow nodes are reactive
    if (props.node.data.vmId) {
      tagSync.pushTags('pve01', Number(props.node.data.vmId), props.node.data.desiredConfig.tags)
    }
  } else {
    const currentTags = props.node.data.tags || []
    if (currentTags.includes(tag)) return
    props.node.data.tags = [...currentTags, tag] // eslint-disable-line vue/no-mutating-props
  }
  tagInput.value = ''
  showTagDropdown.value = false
}

function addPredefinedTag(tagName) {
  if (!props.node) return
  if (props.node.data.deployed && props.node.data.desiredConfig) {
    const currentTags = props.node.data.desiredConfig.tags || []
    if (currentTags.includes(tagName)) return
    props.node.data.desiredConfig.tags = [...currentTags, tagName] // eslint-disable-line vue/no-mutating-props -- VueFlow nodes are reactive
    if (props.node.data.vmId) {
      tagSync.pushTags('pve01', Number(props.node.data.vmId), props.node.data.desiredConfig.tags)
    }
  } else {
    const currentTags = props.node.data.tags || []
    if (currentTags.includes(tagName)) return
    props.node.data.tags = [...currentTags, tagName] // eslint-disable-line vue/no-mutating-props
  }
  showTagDropdown.value = false
}

function removeTag(tagToRemove) {
  if (!props.node) return
  if (props.node.data.deployed && props.node.data.desiredConfig) {
    props.node.data.desiredConfig.tags = (props.node.data.desiredConfig.tags || []).filter(t => t !== tagToRemove) // eslint-disable-line vue/no-mutating-props -- VueFlow nodes are reactive
    if (props.node.data.vmId) {
      tagSync.pushTags('pve01', Number(props.node.data.vmId), props.node.data.desiredConfig.tags)
    }
  } else {
    props.node.data.tags = (props.node.data.tags || []).filter(t => t !== tagToRemove) // eslint-disable-line vue/no-mutating-props
  }
}


// VM lifecycle actions for deployed nodes. These no longer flip status
// optimistically — they route through the task core, which marks the node
// transitional (data.pendingAction), polls the Proxmox task, then confirms or
// reverts the status on real completion.
const VM_ACTION_API = {
  start: 'start',
  stop: 'stop',
  pause: 'pause',
  resume: 'resume',
}

async function handleVmAction(action) {
  const vmId = props.node?.data?.vmId || config.value.vmid
  if (!vmId) return

  const method = VM_ACTION_API[action]
  if (!method) return

  const vmtype = props.node.type === 'lxc' ? 'lxc' : 'qemu'
  const request = { proxmox_node: getProxmoxNode(), vm_id: vmId, vmtype }
  await tasks.launch(action, {
    node: props.node,
    vmId,
    vmtype,
    apiCall: () => proxmoxApi.vm[method](request),
    onSuccess: () => {},
  })
}

const saving = ref(false)
const handleSave = () => {
  if (saving.value) return
  saving.value = true
  const newStatus = isValid.value ? 'orange' : 'gray'
  const payload = {
    config: config.value,
    status: newStatus,
    label: config.value.name || props.node.data?.label,
  }
  // Lift group kind/team_count out of config onto data so GroupNode.vue reads them
  if (props.node?.type === 'group') {
    if (config.value.kind) payload.kind = config.value.kind
    if (config.value.team_count !== undefined && config.value.team_count !== null) {
      payload.team_count = Number(config.value.team_count) || 1
    }
  }
  emit('update', props.node.id, payload)
  emit('close')
  // Reset defensively — the panel normally unmounts on close, but don't leave
  // Save permanently disabled if the parent keeps it alive.
  saving.value = false
}

const handleDelete = () => {
  showDeleteModal.value = true
}

const onDeleteProxmox = async () => {
  showDeleteModal.value = false
  const vmId = props.node.data?.vmId
  if (!vmId) return
  const vmtype = props.node.type === 'lxc' ? 'lxc' : 'qemu'
  await tasks.launch('delete', {
    node: props.node,
    vmId,
    vmtype,
    apiCall: () => props.node.type === 'lxc'
      ? proxmoxApi.lxc.delete(vmId)
      : proxmoxApi.vm.delete(vmId),
    onSuccess: () => {
      emit('delete', props.node.id)
      emit('close')
    },
  })
}

const onRemoveCanvas = () => {
  showDeleteModal.value = false
  emit('delete', props.node.id)
  emit('close')
}

const onDeleteCancel = () => {
  showDeleteModal.value = false
}

const handleBackdropClick = (event) => {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}

const onEscape = () => {
  // Defer to nested dialogs: only close the panel when no overlay is open.
  if (showDeleteModal.value || showApplyDialog.value) return
  emit('close')
}

watch(() => props.node, (newNode) => {
  if (newNode) {
    config.value = JSON.parse(JSON.stringify(newNode.data.config || {}))
    if (newNode.type === 'group') {
      config.value.kind = newNode.data?.kind || 'topology_group'
      config.value.team_count = Number(newNode.data?.team_count ?? config.value.team_count ?? 1)
    }
    config.value.role = config.value.role ?? ''
  }
}, { immediate: true })

const isHostNode = computed(() => ['vm', 'lxc', 'docker'].includes(props.node?.type))

const nodeDataRef = computed(() => props.node?.data || {})
const {
  pendingChanges,
  hasPendingChanges,
  pendingCount,
  revertField,
  revertAll,
  updateDesired,
} = usePendingChanges(nodeDataRef)

const showApplyDialog = ref(false)
// Let the parent (node-card "Apply" strip) open the apply dialog directly.
defineExpose({ openApplyDialog: () => { showApplyDialog.value = true } })
</script>

<template>
  <div class="modal modal-open" @click="handleBackdropClick">
    <div
      ref="modalBox"
      class="modal-box flex max-h-[90vh] w-11/12 max-w-3xl flex-col gap-0 overflow-hidden p-0"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      @click.stop
      @keydown.esc.stop.prevent="onEscape"
    >
      <!-- Header (sticky) -->
      <header class="sticky top-0 z-10 flex items-center gap-3 border-b border-base-300 bg-base-100 px-6 py-4">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          :class="node.data?.deployed ? 'bg-primary/10 text-primary' : 'bg-base-200'"
        >
          <AppIcon :name="typeIcon" class="h-6 w-6" />
        </div>
        <div class="min-w-0 flex-1">
          <h3 :id="titleId" class="truncate text-lg font-semibold leading-tight">
            {{ config.name || typeLabel }}
          </h3>
          <p class="text-xs uppercase tracking-wide opacity-60">
            {{ subtitleState }} · {{ typeLabel }}
          </p>
        </div>

        <!-- Deployed-node status pill + VMID chip -->
        <template v-if="node.data?.deployed">
          <span
            class="badge gap-1.5 border-0 font-medium capitalize"
            :class="statusBadgeClass"
          >
            <span
              class="h-2 w-2 rounded-full bg-current/80"
              :class="{ 'animate-pulse': statusView.pulse }"
            ></span>
            {{ statusView.label }}
          </span>
          <span v-if="node.data.vmId" class="badge badge-ghost shrink-0 font-mono text-xs">
            {{ t('configPanel.vmid', { id: node.data.vmId }) }}
          </span>
        </template>

        <button
          class="btn btn-circle btn-ghost btn-sm shrink-0"
          :aria-label="t('configPanel.a11y.close')"
          @click="emit('close')"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <!-- Content (scrolls between sticky header/footer) -->
      <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <NodeContextNotice :type="node.type" />

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

        <!-- Tag Editor (VM and LXC) -->
        <div v-if="node.type === 'vm' || node.type === 'lxc'" class="space-y-2">
          <label class="text-xs font-medium uppercase tracking-wide opacity-60">
            {{ t('configPanel.tags.label') }}
          </label>
          <div v-if="(node.data.tags || []).length" class="flex min-h-[24px] flex-wrap gap-1.5">
            <span
              v-for="tag in (node.data.tags || [])"
              :key="tag"
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
              :style="{ backgroundColor: getTagColor(tag).hex }"
            >
              {{ tag }}
              <button
                class="ml-0.5 leading-none opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                :aria-label="t('configPanel.a11y.removeTag', { tag })"
                @click="removeTag(tag)"
              >&times;</button>
            </span>
          </div>
          <div class="relative">
            <input
              v-model="tagInput"
              :placeholder="t('configPanel.tags.add')"
              class="input input-bordered input-sm w-full rounded-lg"
              @keydown.enter.prevent="addTag"
              @focus="showTagDropdown = true"
              @blur="setTimeout(() => showTagDropdown = false, 200)"
            />
            <div
              v-if="showTagDropdown && filteredPredefinedTags.length"
              class="absolute z-20 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
            >
              <button
                v-for="tag in filteredPredefinedTags"
                :key="tag.name"
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200"
                @mousedown.prevent="addPredefinedTag(tag.name)"
              >
                <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: tag.hex }"></span>
                {{ tag.name }}
              </button>
            </div>
          </div>
        </div>

        <!-- Role selector (vm / lxc / docker) -->
        <FormSection
          v-if="isHostNode"
          variant="bordered"
          :columns="1"
        >
          <FormField
            v-model="config.role"
            :label="t('configPanel.fields.role')"
            type="select"
            :options="[
              { value: '', label: t('configPanel.fields.roleAuto') },
              { value: 'admin', label: 'admin' },
              { value: 'team', label: 'team' },
              { value: 'trainee', label: 'trainee' },
              { value: 'shared', label: 'shared' },
            ]"
            hint=""
            icon=""
          />
        </FormSection>

        <!-- Deployed VM Status View -->
        <DeployedVmFields v-if="node.type === 'vm' && node.data?.deployed"
          :node="node" :status-view="statusView" :status-dot-class="statusDotClass"
          @action="handleVmAction" @revert-field="revertField" @update-desired="updateDesired" />


        <!-- VM Specific Fields (non-deployed) -->
        <VmFields v-else-if="node.type === 'vm'" v-model="config" :available-templates="availableTemplates" :available-storages="availableStorages" :loading-templates="loadingTemplates" @refresh-templates="loadTemplates(true)" />

        <!-- Network Segment Specific Fields -->
        <NetworkFields v-if="node.type === 'network-segment'" v-model="config" />

        <!-- Router Specific Fields -->
        <RouterFields v-if="node.type === 'router'" v-model="config" />

        <!-- Switch Specific Fields -->
        <SwitchFields v-if="node.type === 'switch'" v-model="config" />

        <!-- Firewall Specific Fields -->
        <FirewallFields v-if="node.type === 'firewall'" v-model="config" />

        <!-- Load Balancer Specific Fields -->
        <LoadBalancerFields v-if="node.type === 'loadbalancer'" v-model="config" />

        <!-- DNS Server Specific Fields -->
        <DnsFields v-if="node.type === 'dns'" v-model="config" />

        <!-- DHCP Server Specific Fields -->
        <DhcpFields v-if="node.type === 'dhcp'" v-model="config" />

        <!-- Docker Container Specific Fields -->
        <DockerFields v-if="node.type === 'docker'" v-model="config" />

        <!-- Group/Container Specific Fields -->
        <GroupFields v-if="node.type === 'group'" v-model="config" />

        <!-- Simulated Internet Specific Fields -->
        <SimulatedInternetFields v-if="node.type === 'simulated-internet'" v-model="config" />

        <!-- Edge Firewall Specific Fields -->
        <EdgeFirewallFields v-if="node.type === 'edge-firewall'" v-model="config" />

        <!-- LXC Container Specific Fields -->
        <LxcFields v-if="node.type === 'lxc'" v-model="config" />

        <!-- Vulnerable Target Specific Fields -->
        <VulnerableTargetFields v-if="node.type === 'vuln-target'" v-model="config" />

        <!-- Per-node Attachments -->
        <NodeAttachmentsSection
          :node="node"
          :attachments="attachments"
          :nodes="nodes"
          @update:attachments="$emit('update:attachments', $event)"
          @open-content="emit('open-content', $event)"
        />

        <!-- Shared Service Specific Fields -->
        <SharedServiceFields v-if="node.type === 'shared-service'" v-model="config" />
      </div>

      <!-- Footer (sticky) -->
      <footer class="sticky bottom-0 z-10 border-t border-base-300 bg-base-100 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]">
        <!-- Pending-changes strip (deployed nodes with unsaved diffs) -->
        <div
          v-if="hasPendingChanges"
          class="mx-4 mt-4 flex items-center gap-3 rounded-box border border-warning/30 bg-warning/10 px-3 py-2"
        >
          <svg class="h-4 w-4 shrink-0 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span class="text-sm font-medium">{{ t('configPanel.pending.title') }}</span>
          <span class="text-xs opacity-60">{{ t('configPanel.pending.count', { n: pendingCount }, pendingCount) }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button class="btn btn-ghost btn-xs" @click="revertAll">{{ t('configPanel.pending.discardAll') }}</button>
            <button class="btn btn-warning btn-xs" @click="showApplyDialog = true">{{ t('configPanel.pending.apply') }}</button>
          </div>
        </div>

        <!-- Action bar -->
        <div class="flex items-center justify-between gap-3 px-6 py-4">
          <div class="flex items-center gap-3">
            <button
              class="btn btn-error btn-outline btn-sm gap-1.5"
              :aria-label="t('configPanel.a11y.delete')"
              @click="handleDelete"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {{ t('configPanel.delete') }}
            </button>
            <div
              v-if="!node.data?.deployed"
              class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              :class="isValid ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'"
            >
              <svg v-if="isValid" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span class="text-sm font-medium">
                {{ isValid ? t('configPanel.status.valid') : t('configPanel.status.missing') }}
              </span>
            </div>
          </div>
          <div v-if="!node.data?.deployed" class="flex gap-2">
            <button class="btn btn-ghost btn-sm" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary btn-sm gap-1.5" :disabled="saving" @click="handleSave">
              <span v-if="saving" class="loading loading-xs"></span>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              {{ saving ? t('configPanel.saving') : t('configPanel.save') }}
            </button>
          </div>
          <button v-else class="btn btn-ghost btn-sm" @click="emit('close')">{{ t('configPanel.close') }}</button>
        </div>
      </footer>
    </div>
  </div>

  <ApplyChangesDialog
    v-if="showApplyDialog"
    :node="node"
    :pending-changes="pendingChanges"
    @close="showApplyDialog = false"
    @applied="showApplyDialog = false"
  />

  <DeleteNodeModal
    :open="showDeleteModal"
    :node="node"
    @deleteProxmox="onDeleteProxmox"
    @removeCanvas="onRemoveCanvas"
    @cancel="onDeleteCancel"
  />
</template>

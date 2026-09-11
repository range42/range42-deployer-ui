<script setup>
import { randomId } from '@/services/randomId'
import FileAssetField from '@/components/project/FileAssetField.vue'
import { fileContentEquals } from '@/services/projectFiles'
import { computed, nextTick, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { createScenarioDraft, emitConcreteScenario } from '@/services/concreteScenario'
import ScenarioReplicationPanel from '@/components/project/ScenarioReplicationPanel.vue'
import ScenarioAllocationPanel from '@/components/project/ScenarioAllocationPanel.vue'
import { applyReplicatedAllocation, prepareReplicatedAllocation } from '@/services/scenarioAllocation'
import CatalogRoleAttachmentPicker from '@/components/project/CatalogRoleAttachmentPicker.vue'
import BundleLibraryModal from '@/components/project/BundleLibraryModal.vue'
import LegacyAttachmentMigration from '@/components/project/LegacyAttachmentMigration.vue'
import { prepareAttachmentMigration, scenarioReviewSource } from '@/services/attachmentMigration'

const props = defineProps({
  open: Boolean, project: { type: Object, required: true },
  nodes: { type: Array, default: () => [] }, edges: { type: Array, default: () => [] },
  initialTarget: { type: String, default: '' },
})
const emit = defineEmits(['close', 'generated'])
const draft = ref(null)
const contentState = ref({})
const preview = ref(null)
const error = ref('')
const focusReady = ref(false)
const heading = ref(null)
const bundleLibraryOpen = ref(false)
const rolePickerOpen = ref(false)
const roleBeingReviewed = ref(null)
const stagedRoleFiles = ref({})
const roleProject = computed(() => ({ ...props.project, files: { ...(props.project.files || {}), ...stagedRoleFiles.value }, scenario: draft.value }))
const migrationChoices = ref({})
const migrateAttachments = ref(false)
let openedSource = ''
const allocationPlan = computed(() => {
  if (!draft.value?.replication) return { vms: draft.value?.vms || [], networks: draft.value?.networks || [] }
  try { return prepareReplicatedAllocation({ scenario: draft.value, nodes: props.nodes, edges: props.edges }) }
  catch (reason) { return { error: reason.message || String(reason) } }
})
const playbookHint = 'Ansible playbook — use hosts: "{{ global_vm_ssh_name }}"'

watch(() => props.open, async open => {
  focusReady.value = false
  bundleLibraryOpen.value = false
  rolePickerOpen.value = false
  stagedRoleFiles.value = {}
  if (!open) return
  draft.value = createScenarioDraft(props.project, props.nodes, props.edges)
  openedSource = scenarioReviewSource(props.project, props.nodes, props.edges)
  migrationChoices.value = {}
  migrateAttachments.value = false
  contentState.value = Object.fromEntries(draft.value.content.map(item => [item.id, {
    content: props.project.files?.[`scenarios/${draft.value.label}/${item.path}`] || '',
    varsText: JSON.stringify(item.vars || {}, null, 2),
  }]))
  preview.value = null
  error.value = ''
  await nextTick()
  focusReady.value = true
}, { immediate: true })

function addContent(kind) {
  if (kind === 'role') { roleBeingReviewed.value = null; rolePickerOpen.value = true; return }
  if (kind === 'bundle') {
    bundleLibraryOpen.value = true
    return
  }
  const id = randomId()
  const suffix = kind === 'script' ? 'sh' : kind === 'playbook' ? 'yml' : 'txt'
  draft.value.content.push({ id, kind, target_node: draft.value.vms.find(vm => vm.node_id === props.initialTarget)?.node_id || draft.value.vms[0]?.node_id || '',
    path: kind === 'bundle' ? 'generic/systems.baseline.default/main.yml' : `content/${kind}-${draft.value.content.length + 1}.${suffix}`,
    ...(kind === 'file' ? { destination: '', mode: '0644' } : {}),
  })
  contentState.value[id] = {
    content: kind === 'script' ? '#!/bin/sh\nset -eu\n# Add guest commands here.\n'
      : kind === 'playbook' ? '- hosts: "{{ global_vm_ssh_name }}"\n  gather_facts: false\n  become: true\n  tasks: []\n' : '',
    varsText: '{}',
  }
}

function attachBundle(item) {
  draft.value.content.push(item)
  contentState.value[item.id] = { content: '', varsText: JSON.stringify(item.vars || {}, null, 2) }
  bundleLibraryOpen.value = false
}

function attachRole({ files, item }) {
  stagedRoleFiles.value = files
  const index = draft.value.content.findIndex(row => row.id === item.id)
  if (index >= 0) draft.value.content.splice(index, 1, item)
  else draft.value.content.push(item)
  contentState.value[item.id] ||= { content: '', varsText: '{}' }
  rolePickerOpen.value = false
}

function moveContent(index, offset) {
  const [item] = draft.value.content.splice(index, 1)
  draft.value.content.splice(index + offset, 0, item)
}

function applyAllocation({ reservation, vms, target_host_id, backend_url }) {
  try {
    const updated = draft.value.replication
      ? applyReplicatedAllocation({ scenario: draft.value, nodes: props.nodes, edges: props.edges }, reservation.assignments)
      : { vms }
    draft.value = { ...draft.value, ...updated, allocation: { reservation, target_host_id, backend_url } }
    error.value = ''
  } catch (reason) { error.value = reason.message || String(reason) }
}

function releaseAllocation({ reservation_id, target_host_id, backend_url }) {
  const saved = draft.value.allocation
  if (saved?.reservation?.reservation_id === reservation_id && saved.target_host_id === target_host_id && saved.backend_url === backend_url) {
    delete draft.value.allocation
  }
}

function connectedEdges(vm, networkId) {
  return props.edges.filter(edge => (edge.source === vm.node_id && edge.target === networkId) || (edge.target === vm.node_id && edge.source === networkId))
}

function review() {
  error.value = ''
  try {
    if (openedSource !== scenarioReviewSource(props.project, props.nodes, props.edges)) throw new Error('Project changed since this editor opened. Reopen scenario configuration and review the current content.')
    const files = { ...(props.project.files || {}), ...stagedRoleFiles.value }
    const scenario = JSON.parse(JSON.stringify(draft.value))
    const written = new Map()
    for (const item of scenario.content) {
      if (!['bundle', 'role'].includes(item.kind)) {
        const path = `scenarios/${scenario.label}/${item.path}`
        const value = contentState.value[item.id].content
        if (written.has(path) && !fileContentEquals(written.get(path), value)) throw new Error(`Content items have different files at the same path: ${item.path}. Choose separate paths.`)
        written.set(path, value)
        files[path] = value
      }
      const vars = JSON.parse(contentState.value[item.id].varsText || '{}')
      if (!vars || Array.isArray(vars) || typeof vars !== 'object') throw new Error('Content variables must be a JSON object')
      item.vars = vars
    }
    let candidate = { scenario, files, attachments: props.project.attachments || [] }
    if (candidate.attachments.length) {
      if (!migrateAttachments.value) throw new Error('Review the legacy attachments and select their conversion before generating scenario files.')
      candidate = prepareAttachmentMigration({ project: { ...props.project, files }, scenario, nodes: props.nodes, choices: migrationChoices.value })
    }
    preview.value = { ...emitConcreteScenario({ ...candidate, nodes: props.nodes, edges: props.edges,
      baseDoc: props.project.baseDoc, overlay: props.project.overlay,
      generatedPaths: props.project.scenario_generated_paths || [] }),
      attachments: candidate.attachments, migrationRows: candidate.rows || [], reviewSource: openedSource }
  } catch (reason) { error.value = reason.message || String(reason) }
}

function applyReview() {
  if (preview.value.reviewSource !== scenarioReviewSource(props.project, props.nodes, props.edges)) {
    preview.value = null
    error.value = 'Project changed since review. Reopen scenario configuration and review the current content.'
    return
  }
  emit('generated', preview.value)
}
</script>

<template>
  <Teleport to="body">
    <FocusTrap v-if="open && draft" :active="focusReady && !bundleLibraryOpen && !rolePickerOpen"
      :fallback-focus="() => heading" :escape-deactivates="false" :return-focus-on-deactivate="true">
      <div class="modal modal-open p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="scenario-authoring-title" @keydown.esc.prevent="emit('close')">
        <section class="modal-box max-w-5xl w-full max-h-[92vh] overflow-y-auto min-w-0">
          <header class="flex items-start justify-between gap-3 mb-4">
            <div class="min-w-0">
              <h2 id="scenario-authoring-title" ref="heading" tabindex="-1" class="font-bold text-xl">Configure executable scenario</h2>
              <p class="text-sm text-base-content/70 mt-1">Prepare networks, clone VMs, then apply files, scripts and Ansible configuration.</p>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" aria-label="Close scenario configuration" @click="emit('close')">✕</button>
          </header>

          <template v-if="!preview">
            <p class="text-sm mb-4">Use existing templates and connect each VM to its networks on the canvas. The first interface (net0) carries SSH access and the default route. Leave resource overrides empty to inherit the template; disk changes only grow an existing disk.</p>
            <div class="grid gap-3 sm:grid-cols-3 mb-5">
              <label class="form-control gap-1"><span>Scenario name</span><input v-model="draft.label" class="input input-bordered w-full" data-testid="scenario-label" placeholder="demo_lab" /></label>
              <label class="form-control gap-1"><span>Networking</span><select v-model="draft.network_mode" class="select select-bordered w-full" data-testid="scenario-network-mode"><option value="sdn">SDN (default)</option><option value="existing_bridge">Existing bridges</option></select></label>
              <label v-if="draft.network_mode === 'sdn'" class="form-control gap-1"><span>SDN zone</span><input v-model="draft.zone" class="input input-bordered w-full" placeholder="r42lab" /></label>
            </div>
            <p v-if="draft.network_mode === 'sdn'" class="text-sm text-base-content/70 mb-4">Uses the current Hyde SDN bootstrap bundle with a Simple zone. Outbound NAT is explicit per subnet. Backend preflight checks the installed bundle and target network conflicts.</p>

            <ScenarioReplicationPanel v-model="draft.replication" :scenario="draft" :project-id="project.id" :nodes="nodes" :edges="edges" />

            <h3 class="font-semibold mb-2">Source networks</h3>
            <p v-if="!draft.networks.length" class="text-sm text-warning">No network nodes found. Add a network segment to the canvas.</p>
            <fieldset v-for="network in draft.networks" :key="network.id" class="border border-base-300 rounded-lg p-3 mb-3 min-w-0">
              <legend class="text-sm px-1">{{ network.id }}</legend>
              <p v-if="draft.replication && draft.replication.network_scopes[network.id] !== 'shared'" class="text-sm">The explicit subnet and VNet assignments for this source are in the replication plan above.</p>
              <div v-else class="grid gap-3 sm:grid-cols-3">
                <label class="form-control gap-1"><span>{{ draft.network_mode === 'sdn' ? 'VNet name' : 'Bridge name' }}</span><input v-model="network.vnet" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>IPv4 subnet</span><input v-model="network.subnet" class="input input-bordered w-full" placeholder="10.42.1.0/24" /></label>
                <label class="form-control gap-1"><span>Gateway</span><input v-model="network.gateway" class="input input-bordered w-full" placeholder="10.42.1.1" /></label>
              </div>
              <label v-if="draft.network_mode === 'sdn' && (!draft.replication || draft.replication.network_scopes[network.id] === 'shared')" class="flex items-center gap-2 mt-3"><input v-model="network.snat" type="checkbox" class="checkbox checkbox-sm" /> Outbound NAT</label>
            </fieldset>

            <template v-if="project.id">
              <p v-if="allocationPlan.error" role="alert" class="text-sm text-error break-words my-3" data-testid="replication-allocation-error">{{ allocationPlan.error }}</p>
              <template v-else>
                <p v-if="draft.replication" class="text-sm mt-4" data-testid="replication-allocation-counts">Reservations cover {{ allocationPlan.counts.vms }} literal VMs, {{ allocationPlan.counts.networks }} declared networks and {{ allocationPlan.counts.nics }} NICs. Empty VM IDs and addresses can be reserved; VNet names and subnets remain your explicit assignments.</p>
                <ScenarioAllocationPanel :project-id="project.id" :vms="allocationPlan.vms" :networks="allocationPlan.networks"
                  @reserved="applyAllocation" @released="releaseAllocation" />
              </template>
            </template>

            <h3 class="font-semibold mt-5 mb-2">Virtual machines</h3>
            <p v-if="!draft.vms.length" class="text-sm text-warning">No VM nodes found. Add a VM to the canvas and connect it to a network.</p>
            <fieldset v-for="vm in draft.vms" :key="vm.node_id" class="border border-base-300 rounded-lg p-3 mb-3 min-w-0">
              <legend class="text-sm px-1">{{ vm.node_id }}</legend>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="form-control gap-1"><span>{{ draft.replication && draft.replication.node_scopes[vm.node_id] !== 'shared' ? 'VM name prefix' : 'VM name' }}</span><input v-model="vm.vm_name" class="input input-bordered w-full" /></label>
                <label v-if="!draft.replication || draft.replication.node_scopes[vm.node_id] === 'shared'" class="form-control gap-1"><span>New VMID</span><input v-model.number="vm.vm_id" type="number" min="100" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>Existing template VMID</span><input v-model.number="vm.template_vm_id" type="number" min="100" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>Guest SSH user</span><input v-model="vm.ssh_user" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>CPU cores</span><input v-model.number="vm.cores" type="number" min="1" max="128" class="input input-bordered w-full" data-testid="scenario-vm-cores" placeholder="From template" /></label>
                <label class="form-control gap-1"><span>Memory (MiB)</span><input v-model.number="vm.memory_mb" type="number" min="128" class="input input-bordered w-full" data-testid="scenario-vm-memory" placeholder="From template" /></label>
                <label class="form-control gap-1"><span>Disk size (GiB)</span><input v-model.number="vm.disk_gb" type="number" min="1" class="input input-bordered w-full" placeholder="From template" /></label>
                <label v-if="vm.disk_gb" class="form-control gap-1"><span>Existing disk device</span><input v-model="vm.disk_device" class="input input-bordered w-full" placeholder="scsi0" /></label>
              </div>
              <div v-for="(nic, nicIndex) in vm.nics" :key="nicIndex" class="grid gap-3 sm:grid-cols-2 mt-3 border-t border-base-300 pt-3">
                <label class="form-control gap-1"><span>net{{ nicIndex }} network{{ nicIndex === 0 ? ' (management)' : '' }}</span><select v-model="nic.network_id" :disabled="!!draft.replication" class="select select-bordered w-full"><option value="" disabled>Choose connected network</option><option v-for="network in draft.networks" :key="network.id" :value="network.id">{{ network.vnet || network.id }}</option></select></label>
                <label v-if="!draft.replication || draft.replication.node_scopes[vm.node_id] === 'shared'" class="form-control gap-1"><span>net{{ nicIndex }} IPv4 address</span><input v-model="nic.ip" class="input input-bordered w-full" placeholder="10.42.1.10" /></label>
                <label v-if="draft.replication" class="form-control gap-1"><span>Stable source NIC key</span><select v-model="nic.key" class="select select-bordered w-full" @change="nicIndex === 0 && (vm.primary_nic_key = nic.key)"><option value="" disabled>Select the matching canvas link</option><option v-for="edge in connectedEdges(vm, nic.network_id)" :key="edge.id" :value="edge.id">{{ edge.id }}</option></select></label>
              </div>
            </fieldset>

            <h3 class="font-semibold mt-5 mb-2">Content after VM bootstrap</h3>
            <p class="text-sm text-base-content/70 mb-3">Items run in the displayed order. File and script tasks use privilege escalation. SSH keys and credentials come from the backend workspace.</p>
            <template v-if="project.attachments?.length">
              <LegacyAttachmentMigration :attachments="project.attachments" :nodes="nodes" :files="project.files || {}" v-model:choices="migrationChoices" />
              <label class="flex gap-2 items-start text-sm mb-4"><input v-model="migrateAttachments" type="checkbox" class="checkbox checkbox-sm" data-testid="migration-confirm" /> Include the reviewed attachment conversion in this scenario preview.</label>
            </template>
            <div class="flex flex-wrap gap-2 mb-3">
              <button v-for="kind in ['file', 'script', 'playbook', 'bundle', 'role']" :key="kind" type="button" class="btn btn-outline btn-sm" :data-testid="`scenario-add-${kind}`" @click="addContent(kind)">Add {{ kind }}</button>
            </div>
            <fieldset v-for="(item, index) in draft.content" :key="item.id" class="border border-base-300 rounded-lg p-3 mb-3 min-w-0">
              <legend class="px-1 text-sm">{{ index + 1 }}. {{ item.kind }}</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="form-control gap-1"><span>Target VM</span><select v-model="item.target_node" class="select select-bordered w-full"><option v-for="vm in draft.vms" :key="vm.node_id" :value="vm.node_id">{{ vm.vm_name }}</option></select></label>
                <label class="form-control gap-1"><span>{{ item.kind === 'role' ? 'Role directory in this project' : item.kind === 'bundle' ? 'Verified bundle path' : 'File path relative to the scenario directory' }}</span><input v-model="item.path" :readonly="['bundle', 'role'].includes(item.kind)" class="input input-bordered w-full" data-testid="content-path" /></label>
                <label v-if="item.kind === 'file'" class="form-control gap-1"><span>Destination on guest</span><input v-model="item.destination" class="input input-bordered w-full" data-testid="content-destination" placeholder="/etc/example.conf" /></label>
                <label v-if="item.kind === 'file'" class="form-control gap-1"><span>File mode</span><input v-model="item.mode" class="input input-bordered w-full" placeholder="0644" /></label>
              </div>
              <p v-if="item.kind === 'bundle'" class="text-xs text-base-content/70 mt-2 break-all">{{ item.resolution ? `Source commit: ${item.resolution.source_sha} · Installed runtime: ${item.resolution.runtime.fingerprint}` : 'Remove this unverified attachment and select it from the bundle library.' }}</p>
              <div v-if="item.kind === 'role'" class="text-sm mt-3">
                <p class="break-all">Original catalog commit: {{ item.role?.origin?.sha }}. Current role files are copied into this project and checked against their reviewed hashes.</p>
                <button type="button" class="btn btn-outline btn-sm mt-2" @click="roleBeingReviewed = item; rolePickerOpen = true">Review current role files</button>
              </div>
              <FileAssetField v-if="item.kind === 'file'" v-model="contentState[item.id].content" :filename="item.path.split('/').at(-1)" class="mt-3" />
              <label v-if="!['bundle', 'role'].includes(item.kind) && typeof contentState[item.id].content === 'string'" class="form-control gap-1 mt-3"><span>{{ item.kind === 'playbook' ? playbookHint : 'Content' }}</span><textarea v-model="contentState[item.id].content" class="textarea textarea-bordered font-mono w-full min-h-36" data-testid="content-text" spellcheck="false" /></label>
              <label class="form-control gap-1 mt-3"><span>Non-secret variables (JSON)</span><textarea v-model="contentState[item.id].varsText" class="textarea textarea-bordered font-mono w-full" spellcheck="false" /></label>
              <button type="button" class="btn btn-ghost btn-sm mt-2" :disabled="index === 0" :data-testid="`content-move-up-${item.id}`" @click="moveContent(index, -1)">Move up</button>
              <button type="button" class="btn btn-ghost btn-sm mt-2" :disabled="index === draft.content.length - 1" @click="moveContent(index, 1)">Move down</button>
              <button type="button" class="btn btn-ghost btn-sm mt-2" @click="draft.content.splice(index, 1)">Remove item</button>
            </fieldset>
            <p v-if="error" role="alert" class="alert alert-error break-words">{{ error }}</p>
            <footer class="flex justify-end gap-2 mt-5"><button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button><button type="button" class="btn btn-primary" data-testid="scenario-review" @click="review">Review generated files</button></footer>
          </template>

          <template v-else>
            <p v-if="preview.migrationRows.length" class="text-sm mb-3" data-testid="migration-summary">{{ preview.migrationRows.length }} legacy attachments will become scenario content. Original records are kept in content/legacy-attachments.json; active attachments are replaced only when this whole update is saved.</p>
            <p v-for="warning in preview.warnings || []" :key="warning" class="text-sm rounded-lg border border-warning/50 bg-warning/10 p-3 mb-3">{{ warning }}</p>
            <p class="mb-3">Review these files before adding them to the project. Saving the project checkpoints them on its working branch; deployment still requires backend preflight.</p>
            <details v-for="path in Object.keys(preview.files).sort()" :key="path" class="border border-base-300 rounded-lg p-3 mb-2 min-w-0">
              <summary class="font-mono text-sm cursor-pointer break-all">{{ path }}</summary>
              <pre v-if="typeof preview.files[path] === 'string'" class="text-xs overflow-x-auto max-h-72 mt-3">{{ preview.files[path] }}</pre>
              <FileAssetField v-else :model-value="preview.files[path]" :filename="path.split('/').at(-1)" readonly class="mt-3" />
            </details>
            <footer class="flex flex-wrap justify-end gap-2 mt-5"><button type="button" class="btn btn-ghost" @click="preview = null">Back to configuration</button><button type="button" class="btn btn-primary" data-testid="scenario-apply" @click="applyReview">Use scenario files</button></footer>
          </template>
        </section>
      </div>
    </FocusTrap>
    <CatalogRoleAttachmentPicker v-if="open && rolePickerOpen" :open="rolePickerOpen" :project="roleProject" :vms="draft.vms" :initial-target="initialTarget"
      :existing-item="roleBeingReviewed" @selected="attachRole" @close="rolePickerOpen = false" />
    <BundleLibraryModal v-if="open && draft" :open="bundleLibraryOpen" :vms="draft.vms" @selected="attachBundle" @close="bundleLibraryOpen = false" />
  </Teleport>
</template>

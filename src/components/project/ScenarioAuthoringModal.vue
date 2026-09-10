<script setup>
import { nextTick, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { createScenarioDraft, emitConcreteScenario } from '@/services/concreteScenario'
import BundleLibraryModal from '@/components/project/BundleLibraryModal.vue'

const props = defineProps({
  open: Boolean, project: { type: Object, required: true },
  nodes: { type: Array, default: () => [] }, edges: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'generated'])
const draft = ref(null)
const contentState = ref({})
const preview = ref(null)
const error = ref('')
const focusReady = ref(false)
const heading = ref(null)
const bundleLibraryOpen = ref(false)
const playbookHint = 'Ansible playbook — use hosts: "{{ global_vm_ssh_name }}"'

watch(() => props.open, async open => {
  focusReady.value = false
  bundleLibraryOpen.value = false
  if (!open) return
  draft.value = createScenarioDraft(props.project, props.nodes, props.edges)
  contentState.value = Object.fromEntries(draft.value.content.map(item => [item.id, {
    text: props.project.files?.[`scenarios/${draft.value.label}/${item.path}`] || '',
    varsText: JSON.stringify(item.vars || {}, null, 2),
  }]))
  preview.value = null
  error.value = ''
  await nextTick()
  focusReady.value = true
}, { immediate: true })

function addContent(kind) {
  if (kind === 'bundle') {
    bundleLibraryOpen.value = true
    return
  }
  const id = crypto.randomUUID()
  const suffix = kind === 'script' ? 'sh' : kind === 'playbook' ? 'yml' : 'txt'
  draft.value.content.push({ id, kind, target_node: draft.value.vms[0]?.node_id || '',
    path: kind === 'bundle' ? 'generic/systems.baseline.default/main.yml' : `content/${kind}-${draft.value.content.length + 1}.${suffix}`,
    ...(kind === 'file' ? { destination: '', mode: '0644' } : {}),
  })
  contentState.value[id] = {
    text: kind === 'script' ? '#!/bin/sh\nset -eu\n# Add guest commands here.\n'
      : kind === 'playbook' ? '- hosts: "{{ global_vm_ssh_name }}"\n  gather_facts: false\n  become: true\n  tasks: []\n' : '',
    varsText: '{}',
  }
}

function attachBundle(item) {
  draft.value.content.push(item)
  contentState.value[item.id] = { text: '', varsText: JSON.stringify(item.vars || {}, null, 2) }
  bundleLibraryOpen.value = false
}

function review() {
  error.value = ''
  try {
    const files = { ...(props.project.files || {}) }
    const scenario = JSON.parse(JSON.stringify(draft.value))
    for (const item of scenario.content) {
      if (item.kind !== 'bundle') files[`scenarios/${scenario.label}/${item.path}`] = contentState.value[item.id].text
      const vars = JSON.parse(contentState.value[item.id].varsText || '{}')
      if (!vars || Array.isArray(vars) || typeof vars !== 'object') throw new Error('Content variables must be a JSON object')
      item.vars = vars
    }
    preview.value = emitConcreteScenario({ scenario, nodes: props.nodes, edges: props.edges,
      baseDoc: props.project.baseDoc, overlay: props.project.overlay,
      files, attachments: props.project.attachments || [], generatedPaths: props.project.scenario_generated_paths || [] })
  } catch (reason) { error.value = reason.message || String(reason) }
}
</script>

<template>
  <Teleport to="body">
    <FocusTrap v-if="open && draft" :active="focusReady && !bundleLibraryOpen"
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

            <h3 class="font-semibold mb-2">Networks</h3>
            <p v-if="!draft.networks.length" class="text-sm text-warning">No network nodes found. Add a network segment to the canvas.</p>
            <fieldset v-for="network in draft.networks" :key="network.id" class="border border-base-300 rounded-lg p-3 mb-3 min-w-0">
              <legend class="text-sm px-1">{{ network.id }}</legend>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="form-control gap-1"><span>{{ draft.network_mode === 'sdn' ? 'VNet name' : 'Bridge name' }}</span><input v-model="network.vnet" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>IPv4 subnet</span><input v-model="network.subnet" class="input input-bordered w-full" placeholder="10.42.1.0/24" /></label>
                <label class="form-control gap-1"><span>Gateway</span><input v-model="network.gateway" class="input input-bordered w-full" placeholder="10.42.1.1" /></label>
              </div>
              <label v-if="draft.network_mode === 'sdn'" class="flex items-center gap-2 mt-3"><input v-model="network.snat" type="checkbox" class="checkbox checkbox-sm" /> Outbound NAT</label>
            </fieldset>

            <h3 class="font-semibold mt-5 mb-2">Virtual machines</h3>
            <p v-if="!draft.vms.length" class="text-sm text-warning">No VM nodes found. Add a VM to the canvas and connect it to a network.</p>
            <fieldset v-for="vm in draft.vms" :key="vm.node_id" class="border border-base-300 rounded-lg p-3 mb-3 min-w-0">
              <legend class="text-sm px-1">{{ vm.node_id }}</legend>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="form-control gap-1"><span>VM name</span><input v-model="vm.vm_name" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>New VMID</span><input v-model.number="vm.vm_id" type="number" min="100" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>Existing template VMID</span><input v-model.number="vm.template_vm_id" type="number" min="100" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>Guest SSH user</span><input v-model="vm.ssh_user" class="input input-bordered w-full" /></label>
                <label class="form-control gap-1"><span>CPU cores</span><input v-model.number="vm.cores" type="number" min="1" max="128" class="input input-bordered w-full" data-testid="scenario-vm-cores" placeholder="From template" /></label>
                <label class="form-control gap-1"><span>Memory (MiB)</span><input v-model.number="vm.memory_mb" type="number" min="128" class="input input-bordered w-full" data-testid="scenario-vm-memory" placeholder="From template" /></label>
                <label class="form-control gap-1"><span>Disk size (GiB)</span><input v-model.number="vm.disk_gb" type="number" min="1" class="input input-bordered w-full" placeholder="From template" /></label>
                <label v-if="vm.disk_gb" class="form-control gap-1"><span>Existing disk device</span><input v-model="vm.disk_device" class="input input-bordered w-full" placeholder="scsi0" /></label>
              </div>
              <div v-for="(nic, nicIndex) in vm.nics" :key="nicIndex" class="grid gap-3 sm:grid-cols-2 mt-3 border-t border-base-300 pt-3">
                <label class="form-control gap-1"><span>net{{ nicIndex }} network{{ nicIndex === 0 ? ' (management)' : '' }}</span><select v-model="nic.network_id" class="select select-bordered w-full"><option value="" disabled>Choose connected network</option><option v-for="network in draft.networks" :key="network.id" :value="network.id">{{ network.vnet || network.id }}</option></select></label>
                <label class="form-control gap-1"><span>net{{ nicIndex }} IPv4 address</span><input v-model="nic.ip" class="input input-bordered w-full" placeholder="10.42.1.10" /></label>
              </div>
            </fieldset>

            <h3 class="font-semibold mt-5 mb-2">Content after VM bootstrap</h3>
            <p class="text-sm text-base-content/70 mb-3">Items run in the displayed order. File and script tasks use privilege escalation. SSH keys and credentials come from the backend workspace.</p>
            <div class="flex flex-wrap gap-2 mb-3">
              <button v-for="kind in ['file', 'script', 'playbook', 'bundle']" :key="kind" type="button" class="btn btn-outline btn-sm" :data-testid="`scenario-add-${kind}`" @click="addContent(kind)">Add {{ kind }}</button>
            </div>
            <fieldset v-for="(item, index) in draft.content" :key="item.id" class="border border-base-300 rounded-lg p-3 mb-3 min-w-0">
              <legend class="px-1 text-sm">{{ index + 1 }}. {{ item.kind }}</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="form-control gap-1"><span>Target VM</span><select v-model="item.target_node" class="select select-bordered w-full"><option v-for="vm in draft.vms" :key="vm.node_id" :value="vm.node_id">{{ vm.vm_name }}</option></select></label>
                <label class="form-control gap-1"><span>{{ item.kind === 'bundle' ? 'Verified bundle path' : 'File path relative to the scenario directory' }}</span><input v-model="item.path" :readonly="item.kind === 'bundle'" class="input input-bordered w-full" data-testid="content-path" /></label>
                <label v-if="item.kind === 'file'" class="form-control gap-1"><span>Destination on guest</span><input v-model="item.destination" class="input input-bordered w-full" data-testid="content-destination" placeholder="/etc/example.conf" /></label>
                <label v-if="item.kind === 'file'" class="form-control gap-1"><span>File mode</span><input v-model="item.mode" class="input input-bordered w-full" placeholder="0644" /></label>
              </div>
              <p v-if="item.kind === 'bundle'" class="text-xs text-base-content/70 mt-2 break-all">{{ item.resolution ? `Source commit: ${item.resolution.source_sha} · Installed runtime: ${item.resolution.runtime.fingerprint}` : 'Remove this unverified attachment and select it from the bundle library.' }}</p>
              <label v-if="item.kind !== 'bundle'" class="form-control gap-1 mt-3"><span>{{ item.kind === 'playbook' ? playbookHint : 'Content' }}</span><textarea v-model="contentState[item.id].text" class="textarea textarea-bordered font-mono w-full min-h-36" data-testid="content-text" spellcheck="false" /></label>
              <label v-if="['bundle', 'playbook'].includes(item.kind)" class="form-control gap-1 mt-3"><span>Non-secret variables (JSON)</span><textarea v-model="contentState[item.id].varsText" class="textarea textarea-bordered font-mono w-full" spellcheck="false" /></label>
              <button type="button" class="btn btn-ghost btn-sm mt-2" @click="draft.content.splice(index, 1)">Remove item</button>
            </fieldset>
            <p v-if="error" role="alert" class="alert alert-error break-words">{{ error }}</p>
            <footer class="flex justify-end gap-2 mt-5"><button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button><button type="button" class="btn btn-primary" data-testid="scenario-review" @click="review">Review generated files</button></footer>
          </template>

          <template v-else>
            <p class="mb-3">Review these files before adding them to the project. Saving the project checkpoints them on its working branch; deployment still requires backend preflight.</p>
            <details v-for="path in Object.keys(preview.files).sort()" :key="path" class="border border-base-300 rounded-lg p-3 mb-2 min-w-0">
              <summary class="font-mono text-sm cursor-pointer break-all">{{ path }}</summary>
              <pre class="text-xs overflow-x-auto max-h-72 mt-3">{{ preview.files[path] }}</pre>
            </details>
            <footer class="flex flex-wrap justify-end gap-2 mt-5"><button type="button" class="btn btn-ghost" @click="preview = null">Back to configuration</button><button type="button" class="btn btn-primary" data-testid="scenario-apply" @click="emit('generated', preview)">Use scenario files</button></footer>
          </template>
        </section>
      </div>
    </FocusTrap>
    <BundleLibraryModal v-if="open && draft" :open="bundleLibraryOpen" :vms="draft.vms" @selected="attachBundle" @close="bundleLibraryOpen = false" />
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { useProjectStore } from '@/stores/projectStore'
import { prepareRoleAttachment } from '@/services/catalogRoleExecution'
import { randomId } from '@/services/randomId'

const props = defineProps({ open: Boolean, project: { type: Object, required: true },
  vms: { type: Array, default: () => [] }, initialTarget: { type: String, default: '' }, existingItem: { type: Object, default: null } })
const emit = defineEmits(['selected', 'close'])
const store = useProjectStore()
const sourceId = ref(''), target = ref(''), preview = ref(null), error = ref(''), heading = ref(null), focusReady = ref(false)
const sources = computed(() => {
  const local = store.projects.filter(project => project.catalogRef?.kind === 'ansible_role' && project.id !== props.project.id)
    .map(project => ({ key: `project:${project.id}`, label: project.name, project }))
  const origins = [props.project.catalogRef, props.existingItem?.role?.origin, ...(props.project.scenario?.content || []).map(item => item.role?.origin)]
  const paths = new Set()
  for (const origin of origins) {
    if (origin?.kind !== 'ansible_role' || paths.has(origin.path)) continue
    paths.add(origin.path)
    local.push({ key: `current:${origin.path}`, label: `Current project files: ${origin.path}`, project: { ...props.project, catalogRef: origin } })
  }
  return local
})
const source = computed(() => sources.value.find(row => row.key === sourceId.value))
const identity = computed(() => JSON.stringify({ source: source.value?.project, files: props.project.files, target: target.value, vms: props.vms, existing: props.existingItem }))
watch(identity, () => { preview.value = null; error.value = '' }, { flush: 'sync' })
watch(() => [props.open, props.existingItem], async () => {
  preview.value = null; error.value = ''; focusReady.value = false
  sourceId.value = props.existingItem ? `current:${props.existingItem.path}` : sources.value[0]?.key || ''
  target.value = props.existingItem?.target_node || props.initialTarget || props.vms[0]?.node_id || ''
  await nextTick(); focusReady.value = props.open
}, { immediate: true })
function review() {
  try {
    if (!source.value || !props.vms.some(vm => vm.node_id === target.value)) throw new Error('Choose an imported role and an existing target VM.')
    preview.value = { ...prepareRoleAttachment({ sourceProject: source.value.project, targetFiles: props.project.files || {},
      targetNode: target.value, id: props.existingItem?.id || randomId() }), identity: identity.value }
    error.value = ''
  } catch (reason) { preview.value = null; error.value = reason.message || String(reason) }
}
function attach() {
  if (preview.value?.identity !== identity.value) { preview.value = null; error.value = 'The source or target changed. Review the current files again.'; return }
  emit('selected', { files: preview.value.files, item: preview.value.item })
}
</script>
<template>
  <Teleport to="body">
    <FocusTrap v-if="open" :active="focusReady" :fallback-focus="() => heading" :escape-deactivates="false">
      <div class="modal modal-open p-2 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="role-attachment-title" @keydown.esc.stop.prevent="emit('close')">
        <section class="modal-box max-w-2xl w-full max-h-[90vh] overflow-y-auto min-w-0">
          <h2 id="role-attachment-title" ref="heading" tabindex="-1" class="text-xl font-bold">Attach an imported catalog role</h2>
          <p class="text-sm mt-3">Use or Customize an Ansible role from Catalog first. This copies its current local files into this scenario. The role runs with facts and privilege escalation on the selected VM, after bootstrap. Replicated VMs each receive the role.</p>
          <p class="text-sm mt-2">Review trusted role code before execution. Roles may run commands on the guest. External role dependencies, controller lookups and connection overrides require separate support. Initial limits: 512 role files, 1 MiB per file and 2 MiB for the whole project.</p>
          <p v-if="!sources.length" class="alert mt-3">No imported roles are available. Close this dialog and use Catalog → Customize to save a role locally, then return to this scenario.</p>
          <label class="form-control gap-1 mt-4"><span>Local role source</span><select v-model="sourceId" class="select select-bordered w-full" data-testid="role-source"><option value="" disabled>Choose a role</option><option v-for="row in sources" :key="row.key" :value="row.key">{{ row.label }}</option></select></label>
          <label class="form-control gap-1 mt-3"><span>Target VM</span><select v-model="target" class="select select-bordered w-full" data-testid="role-target"><option v-for="vm in vms" :key="vm.node_id" :value="vm.node_id">{{ vm.vm_name || vm.node_id }}</option></select></label>
          <p v-if="source" class="text-xs break-all mt-3">Original catalog: {{ source.project.catalogRef.repo_owner }}/{{ source.project.catalogRef.repo_name }} · {{ source.project.catalogRef.path }} · {{ source.project.catalogRef.sha }}</p>
          <div v-if="preview" class="rounded border border-base-300 p-3 mt-3 text-sm" data-testid="role-review-summary">
            <p>{{ Object.keys(preview.item.role.file_hashes).length }} current files reviewed. Their SHA256 hashes describe these authored bytes separately from the original catalog commit. The backend runs your pinned project; this is not an installed-runtime bundle proof.</p>
            <p class="mt-2">Changes are staged until you review and use the complete scenario files. Edit non-secret role variables and execution order in the content list.</p>
          </div>
          <p v-if="error" role="alert" class="alert alert-error break-words mt-3">{{ error }}</p>
          <footer class="flex flex-wrap justify-end gap-2 mt-4">
            <button type="button" class="btn btn-ghost" data-testid="role-cancel" @click="emit('close')">Cancel</button>
            <button v-if="!preview" type="button" class="btn btn-primary" data-testid="role-review" :disabled="!sources.length || !vms.length" @click="review">Review role files</button>
            <button v-else type="button" class="btn btn-primary" data-testid="role-attach" @click="attach">Stage role attachment</button>
          </footer>
        </section>
      </div>
    </FocusTrap>
  </Teleport>
</template>

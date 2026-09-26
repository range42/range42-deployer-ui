<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { appendPlatformComponent, type PlatformComponent } from '@/services/platformComponents'
import type { ProjectDraft } from '@/types/project'
const props = defineProps<{ project: ProjectDraft }>()
const emit = defineEmits<{ close: []; add: [component: PlatformComponent] }>()
const form = reactive({ id: 'platform', domain: '', profile: 'core', vmid_start: '', template_vmid: '', subnet: '', gateway: '', bridge: '', node: 'pve01', ssh_user: 'alice', dns: '1.1.1.1' })
const fields = [
  ['id', 'Stack name', 'platform'], ['domain', 'Domain', 'platform.example.org'],
  ['vmid_start', 'First VM ID', '31000'], ['template_vmid', 'Template VM ID', '9221'],
  ['subnet', 'Private subnet', '10.81.0.0/24'], ['gateway', 'Gateway', '10.81.0.1'],
  ['bridge', 'New network name', 'r42alpha'], ['node', 'Proxmox node', 'pve01'],
  ['ssh_user', 'Template SSH user', 'alice'], ['dns', 'DNS server', '1.1.1.1'],
] as const
const preview = ref<PlatformComponent | null>(null), busy = ref(false), error = ref(''), active = ref(false)
let generation = 0
watch(form, () => { generation++; preview.value = null; error.value = ''; busy.value = false }, { flush: 'sync' })
watch(() => props.project.id, () => { generation++; preview.value = null; busy.value = false })
onMounted(async () => { await nextTick(); active.value = true })
onBeforeUnmount(() => { generation++ })
async function review() {
  const request = ++generation, scope = getBackendScope()
  busy.value = true; error.value = ''; preview.value = null
  try {
    const result = await backendRequest<PlatformComponent>('/v1/platform/components/preview', { method: 'POST',
      body: JSON.stringify({ ...form, vmid_start: Number(form.vmid_start), template_vmid: Number(form.template_vmid) }) })
    if (request !== generation || scope !== getBackendScope()) return
    appendPlatformComponent(props.project, result)
    preview.value = result
  } catch (cause) { if (request === generation) error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (request === generation) busy.value = false }
}
</script>
<template>
  <FocusTrap :active="active" initial-focus="#stack-title" fallback-focus="#stack-title" :escape-deactivates="false">
    <div class="modal modal-open z-[110] p-3 transition-none" role="dialog" aria-modal="true" aria-labelledby="stack-title" @keydown.esc.prevent="emit('close')">
      <div class="modal-box max-w-3xl max-h-[90vh] overflow-y-auto">
        <h2 id="stack-title" tabindex="-1" class="text-xl font-semibold">Add Range42 stack</h2>
        <p class="mt-2 text-sm">Add an independent platform to this project. Its machines share a private network. Save the project, then use Deploy stack on the canvas.</p>
        <form class="mt-4 space-y-4" @submit.prevent="review">
          <label class="form-control gap-1"><span>Services</span><select v-model="form.profile" name="profile" class="select select-bordered w-full">
            <option value="core">Core: gateway, API, UI, CLI and reporting (5 VMs)</option>
            <option value="full">All available services (11 VMs)</option>
          </select></label>
          <p class="text-sm text-base-content/70">The full stack also includes Wazuh, Gitea, registry, Mattermost, Rocket.Chat and Nextcloud. EMP and MISP are unavailable in this release.</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="[name, label, hint] in fields" :key="name" class="form-control gap-1">
              <span class="text-sm">{{ label }}</span><input v-model="form[name]" :name="name" :placeholder="hint" :type="['vmid_start', 'template_vmid'].includes(name) ? 'number' : 'text'" required class="input input-bordered w-full" autocomplete="off" />
            </label>
          </div>
          <p class="text-sm text-base-content/70">Use an existing VM template. The stack inherits its CPU, memory and disk. Deployment also requires the backend's release files, a dedicated credential profile, DNS and a gateway certificate.</p>
          <p v-if="error" role="alert" class="text-error text-sm">{{ error }}</p>
          <button type="submit" class="btn btn-outline" data-testid="platform-review" :disabled="busy">{{ busy ? 'Preparing preview…' : 'Review stack' }}</button>
        </form>
        <section v-if="preview" class="mt-4 rounded-lg border border-base-300 p-3" aria-label="Stack preview">
          <p class="font-medium">{{ preview.plan.id }} · {{ preview.plan.subnet }}</p>
          <ul class="mt-2 text-sm space-y-1"><li v-for="vm in preview.plan.vms" :key="vm.vm_id">{{ vm.service }} · VM {{ vm.vm_id }} · {{ vm.vm_name }}</li></ul>
          <p class="mt-2 text-xs">These resources will be checked again against Proxmox before deployment.</p>
        </section>
        <footer class="modal-action flex-wrap">
          <button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button>
          <button v-if="preview" type="button" class="btn btn-primary" data-testid="platform-add" @click="emit('add', preview)">Add stack to project</button>
        </footer>
      </div>
    </div>
  </FocusTrap>
</template>

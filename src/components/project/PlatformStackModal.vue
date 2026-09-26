<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { FocusTrap } from 'focus-trap-vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { appendPlatformComponent, type PlatformComponent } from '@/services/platformComponents'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { createSdnInventoryClient, type SdnHost } from '@/services/sdnInventory'
import { suggestStackSettings, type StackInventory } from '@/services/platformSuggestions'
import type { ProjectDraft } from '@/types/project'
const props = defineProps<{ project: ProjectDraft }>()
const emit = defineEmits<{ close: []; add: [component: PlatformComponent] }>()
const form = reactive({ id: 'platform', domain: '', profile: 'core', vmid_start: '', template_vmid: '', subnet: '', gateway: '', bridge: '', node: 'pve01', ssh_user: 'alice', dns: '1.1.1.1' })
const fields = [
  ['id', 'Stack name', 'platform'], ['domain', 'Domain', 'platform.example.org'],
  ['vmid_start', 'First new VM ID', '31000'],
  ['subnet', 'Private subnet', '10.81.0.0/24'], ['gateway', 'Gateway', '10.81.0.1'],
  ['bridge', 'New network name', 'r42alpha'],
  ['ssh_user', 'Template SSH user', 'alice'], ['dns', 'DNS server', '1.1.1.1'],
] as const
const preview = ref<PlatformComponent | null>(null), busy = ref(false), error = ref(''), active = ref(false)
let generation = 0
watch(form, () => { generation++; preview.value = null; error.value = ''; busy.value = false }, { flush: 'sync' })
watch(() => props.project.id, () => { generation++; preview.value = null; busy.value = false })
onMounted(async () => { await nextTick(); active.value = true })
onBeforeUnmount(() => { generation++; inventoryEpoch++ })
const backend = useBackendApiStore()
const hosts = ref<SdnHost[]>([]), hostId = ref(''), inventoryBusy = ref(false), inventoryError = ref('')
type Template = { vmid: number; name?: string; type: string; template: boolean; node: string }
const templates = ref<Template[]>([]), inventory = ref<StackInventory | null>(null)
let inventoryEpoch = 0
const count = computed(() => form.profile === 'full' ? 11 : 5)
const suggestions = computed(() => {
  if (!inventory.value) return null
  try { return suggestStackSettings(props.project, inventory.value, count.value, form.id) }
  catch { return null }
})
function useSuggestions() {
  if (!suggestions.value) return
  form.vmid_start = String(suggestions.value.vmidStarts[0] || '')
  const network = suggestions.value.networks[0]
  if (network) Object.assign(form, network)
}
function clearInventory() {
  generation++; inventoryEpoch++; inventory.value = null; templates.value = []; preview.value = null
  Object.assign(form, { template_vmid: '', vmid_start: '', subnet: '', gateway: '', bridge: '', node: '' })
}
async function loadHosts() {
  clearInventory(); hosts.value = []; hostId.value = ''; inventoryError.value = ''; inventoryBusy.value = true
  const current = inventoryEpoch
  try {
    const rows = await createSdnInventoryClient().hosts()
    if (current !== inventoryEpoch) return
    hosts.value = rows
    if (rows.length === 1) hostId.value = rows[0]!.id
    else if (!rows.length) inventoryError.value = 'No Proxmox target is registered. Add a target in Settings first.'
  } catch (cause) { if (current === inventoryEpoch) inventoryError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (current === inventoryEpoch) inventoryBusy.value = false }
}
async function loadInventory() {
  clearInventory(); inventoryError.value = ''
  const host = hosts.value.find(row => row.id === hostId.value)
  if (!host) { inventoryBusy.value = false; return }
  form.node = host.node_name
  const current = inventoryEpoch, client = createSdnInventoryClient()
  inventoryBusy.value = true
  try {
    const [vms, vnets] = await Promise.all([
      backendRequest<{ items: Template[]; total: number }>(`/v1/proxmox/hosts/${encodeURIComponent(host.id)}/vms`), client.vnets(host.id),
    ])
    client.guard()
    if (current !== inventoryEpoch) return
    if (!Array.isArray(vms.items) || vms.items.length !== vms.total || vms.items.some(vm => !Number.isSafeInteger(vm.vmid) || vm.vmid < 100)) throw new Error('VM inventory is incomplete. Refresh before selecting a template.')
    const subnets: string[] = []
    for (let start = 0; start < vnets.length; start += 4) {
      const rows = await Promise.all(vnets.slice(start, start + 4).map(vnet => client.subnets(host.id, vnet.vnet)))
      if (current !== inventoryEpoch) return
      subnets.push(...rows.flat().map(row => row.cidr))
    }
    if (current !== inventoryEpoch) return
    templates.value = vms.items.filter(vm => vm.template && vm.type === 'qemu').sort((a, b) => a.vmid - b.vmid)
    inventory.value = { vmids: vms.items.map(vm => vm.vmid), vnets: vnets.map(vnet => vnet.vnet), subnets }
    if (templates.value.length === 1) form.template_vmid = String(templates.value[0]!.vmid)
    useSuggestions()
  } catch (cause) { if (current === inventoryEpoch) inventoryError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { if (current === inventoryEpoch) inventoryBusy.value = false }
}
watch(hostId, id => { if (id) void loadInventory() })
watch(() => [backend.url, backend.token, backend.activeHost?.id, props.project.id], loadHosts, { immediate: true })
async function review() {
  const request = ++generation, scope = getBackendScope()
  busy.value = true; error.value = ''; preview.value = null
  try {
    if (!inventory.value || !templates.value.some(vm => vm.vmid === Number(form.template_vmid))) throw new Error('Choose a source VM template from the selected Proxmox target.')
    const start = Number(form.vmid_start), end = start + count.value - 1
    if (inventory.value.vmids.some(id => id >= start && id <= end)) throw new Error(`VM IDs ${start}–${end} include an existing VM or template. Choose one of the suggested ranges or enter another unused range.`)
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
          <div class="flex items-end gap-3">
            <label class="form-control gap-1 flex-1"><span>Proxmox target</span><select v-model="hostId" name="host_id" class="select select-bordered w-full" required :disabled="inventoryBusy"><option value="" disabled>Choose a target</option><option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.name }} · {{ host.node_name }}</option></select></label>
            <button type="button" class="btn btn-outline" :disabled="inventoryBusy" @click="hostId ? loadInventory() : loadHosts()">Refresh</button>
          </div>
          <p v-if="inventoryBusy" role="status" class="text-sm">Loading templates and network suggestions…</p>
          <p v-if="inventoryError" role="alert" class="text-error text-sm">{{ inventoryError }}</p>
          <label class="form-control gap-1"><span>Source VM template</span><select v-model="form.template_vmid" name="template_vmid" class="select select-bordered w-full" required :disabled="inventoryBusy || !templates.length"><option value="" disabled>Choose a template</option><option v-for="vm in templates" :key="vm.vmid" :value="String(vm.vmid)">{{ vm.name || 'Unnamed template' }} · VM {{ vm.vmid }}</option></select></label>
          <p v-if="inventory && !templates.length" class="text-sm">No QEMU VM templates are available on this target.</p>
          <label class="form-control gap-1"><span>Services</span><select v-model="form.profile" name="profile" class="select select-bordered w-full">
            <option value="core">Core: gateway, API, UI, CLI and reporting (5 VMs)</option>
            <option value="full">All available services (11 VMs)</option>
          </select></label>
          <p class="text-sm text-base-content/70">The full stack also includes Wazuh, Gitea, registry, Mattermost, Rocket.Chat and Nextcloud. EMP and MISP are unavailable in this release.</p>
          <section v-if="suggestions" class="rounded-lg bg-base-200 p-3 space-y-2" aria-label="Suggested stack settings">
            <p class="text-sm">{{ count }} VM IDs are needed. Suggestions exclude visible PVE resources and this project's existing allocations.</p>
            <div class="flex flex-wrap gap-2"><span class="text-sm py-1">Suggested VM IDs:</span><button v-for="start in suggestions.vmidStarts" :key="start" type="button" class="btn btn-xs btn-outline" @click="form.vmid_start = String(start)">{{ start }}–{{ start + count - 1 }}</button></div>
            <div class="flex flex-wrap gap-2"><span class="text-sm py-1">Suggested networks:</span><button v-for="network in suggestions.networks" :key="network.subnet" type="button" class="btn btn-xs btn-outline" @click="Object.assign(form, network)">{{ network.subnet }}</button></div>
            <p class="text-xs">A network suggestion fills the subnet, gateway and a new network name. You can edit them below. Availability is checked again during deployment.</p>
          </section>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="[name, label, hint] in fields" :key="name" class="form-control gap-1">
              <span class="text-sm">{{ label }}</span><input v-model="form[name]" :name="name" :placeholder="hint" :type="['vmid_start', 'template_vmid'].includes(name) ? 'number' : 'text'" required class="input input-bordered w-full" autocomplete="off" />
            </label>
          </div>
          <p class="text-sm text-base-content/70">Use an existing VM template. The stack inherits its CPU, memory and disk. Deployment also requires the backend's release files, a dedicated credential profile, DNS and a gateway certificate.</p>
          <p v-if="error" role="alert" class="text-error text-sm">{{ error }}</p>
          <button type="submit" class="btn btn-outline" data-testid="platform-review" :disabled="busy || inventoryBusy || !inventory || !form.template_vmid">{{ busy ? 'Preparing preview…' : 'Review stack' }}</button>
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

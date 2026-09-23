<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { createSdnInventoryClient, type SdnHost, type SdnSubnet, type SdnVnet, type SdnZone } from '@/services/sdnInventory'

const props = defineProps<{ networks: { id: string; vnet: string }[]; initialHostId?: string }>()
const emit = defineEmits<{ selected: [value: { host_id: string; backend_url: string; zone: string; network_id: string; vnet: string; subnet: string; gateway: string; snat: boolean }] }>()
const backend = useBackendApiStore()
const hosts = ref<SdnHost[]>([]), zones = ref<SdnZone[]>([]), vnets = ref<SdnVnet[]>([]), subnets = ref<SdnSubnet[]>([])
const hostId = ref(''), zoneId = ref(''), vnetId = ref(''), subnetId = ref(''), networkId = ref('')
const loaded = ref(false), busy = ref(false), error = ref('')
let generation = 0, client: ReturnType<typeof createSdnInventoryClient> | null = null
const selectedHost = computed(() => hosts.value.find(row => row.id === hostId.value))
const selectedZone = computed(() => zones.value.find(row => row.zone === zoneId.value))
const visibleVnets = computed(() => vnets.value.filter(row => row.zone === zoneId.value))
const selectedVnet = computed(() => visibleVnets.value.find(row => row.vnet === vnetId.value))
const selectedSubnet = computed(() => subnets.value.find(row => row.subnet === subnetId.value))
const settled = (row: { has_pending: boolean; state: string | null }) => !row.has_pending && (row.state === null || row.state === 'unchanged')
const usableZone = (row: SdnZone) => settled(row) && row.type === 'simple' && (!row.nodes.length || row.nodes.includes(selectedHost.value?.node_name || ''))
const usableSubnet = (row: SdnSubnet) => settled(row) && !row.cidr.includes(':') && !!row.gateway && !row.gateway.includes(':')
const canUse = computed(() => !busy.value && selectedZone.value && usableZone(selectedZone.value) && selectedVnet.value && settled(selectedVnet.value) && selectedSubnet.value && usableSubnet(selectedSubnet.value) && props.networks.some(row => row.id === networkId.value))
function clear() {
  generation++; client = null; hosts.value = []; hostId.value = ''; zones.value = []; vnets.value = []; subnets.value = []
  zoneId.value = ''; vnetId.value = ''; subnetId.value = ''; networkId.value = ''; loaded.value = false; busy.value = false; error.value = ''
}
watch(() => [backend.activeHost?.id, backend.url, backend.token, props.initialHostId], clear, { flush: 'sync' })
onUnmounted(clear)
async function run(action: () => Promise<void>) {
  const current = ++generation
  busy.value = true; error.value = ''
  try { await action() }
  catch { if (current === generation) error.value = 'SDN inventory is unavailable or changed. Check backend and SDN read permissions, then refresh.' }
  finally { if (current === generation) busy.value = false }
}
async function load() {
  if (busy.value || !backend.url) return
  clear(); client = createSdnInventoryClient()
  const source = client
  await run(async () => {
    const current = generation, rows = await source.hosts()
    if (current !== generation) return
    hosts.value = rows; loaded.value = true
    if (props.initialHostId && rows.some(row => row.id === props.initialHostId)) hostId.value = props.initialHostId
    else if (props.initialHostId) error.value = 'The reserved deployment host is unavailable in this backend registry. Review the reservation and registered host before reusing SDN settings.'
  })
}
watch(hostId, async () => {
  zoneId.value = ''; zones.value = []; vnets.value = []; subnets.value = []
  const source = client, host = hostId.value
  if (!source || !host) return
  await run(async () => {
    const current = generation
    const [zoneRows, vnetRows] = await Promise.all([source.zones(host), source.vnets(host)])
    if (current !== generation || host !== hostId.value) return
    zones.value = zoneRows; vnets.value = vnetRows
  })
})
watch(zoneId, () => { vnetId.value = ''; subnets.value = []; subnetId.value = '' })
watch(vnetId, async () => {
  subnetId.value = ''; subnets.value = []
  const source = client, host = hostId.value, vnet = vnetId.value
  if (!source || !host || !vnet || !selectedVnet.value || !settled(selectedVnet.value)) return
  await run(async () => {
    const current = generation, rows = await source.subnets(host, vnet)
    if (current === generation && host === hostId.value && vnet === vnetId.value) subnets.value = rows
  })
})
function useSettings() {
  if (!canUse.value || !client || !selectedSubnet.value) return
  try { client.guard() } catch { clear(); return }
  const subnet = selectedSubnet.value
  emit('selected', { host_id: hostId.value, backend_url: backend.url, zone: zoneId.value, network_id: networkId.value,
    vnet: vnetId.value, subnet: subnet.cidr, gateway: subnet.gateway!, snat: subnet.snat })
}
</script>

<template>
  <details class="rounded-xl border border-base-300 p-3 my-4" data-testid="sdn-inventory-picker">
    <summary class="cursor-pointer font-medium">Inspect existing SDN networks</summary>
    <p class="text-sm text-base-content/70 mt-3">Only networks visible to the registered PVE credential are listed. Choose the same host for deployment. These reads show configuration; they do not prove traffic forwarding or reserve guest addresses.</p>
    <button type="button" class="btn btn-outline btn-sm mt-3" data-testid="sdn-load" :disabled="busy || !backend.url" @click="load">Refresh SDN inventory</button>
    <p v-if="error" role="alert" class="text-error text-sm mt-2">{{ error }}</p>
    <div v-if="loaded" class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="form-control gap-1"><span>Registered Proxmox host</span><select v-model="hostId" name="sdn-host" class="select select-bordered w-full" :disabled="busy || !!initialHostId"><option value="">Choose a host</option><option v-for="row in hosts" :key="row.id" :value="row.id">{{ row.name }} · {{ row.node_name }}</option></select></label>
      <label class="form-control gap-1"><span>Existing Simple zone</span><select v-model="zoneId" name="sdn-zone" class="select select-bordered w-full" :disabled="busy"><option value="">Choose a zone</option><option v-for="row in zones" :key="row.zone" :value="row.zone" :disabled="!usableZone(row)">{{ row.zone }} · {{ row.type }}{{ row.has_pending ? ' · pending changes' : '' }}{{ row.nodes.length ? ` · ${row.nodes.join(', ')}` : '' }}</option></select></label>
      <label class="form-control gap-1"><span>Existing VNet</span><select v-model="vnetId" name="sdn-vnet" class="select select-bordered w-full" :disabled="busy"><option value="">Choose a VNet</option><option v-for="row in visibleVnets" :key="row.vnet" :value="row.vnet" :disabled="!settled(row)">{{ row.vnet }}{{ row.has_pending ? ' · pending changes' : '' }}</option></select></label>
      <label class="form-control gap-1"><span>Existing IPv4 subnet</span><select v-model="subnetId" name="sdn-subnet" class="select select-bordered w-full" :disabled="busy"><option value="">Choose a subnet</option><option v-for="row in subnets" :key="row.subnet" :value="row.subnet" :disabled="!usableSubnet(row)">{{ row.cidr }} · {{ row.gateway || 'no gateway' }}{{ row.has_pending ? ' · pending changes' : '' }}</option></select></label>
    </div>
    <div v-if="selectedSubnet" class="mt-3 space-y-3">
      <p class="text-sm">{{ selectedSubnet.cidr }} · Gateway {{ selectedSubnet.gateway }} · Outbound NAT {{ selectedSubnet.snat ? 'enabled' : 'disabled' }}</p>
      <label class="form-control gap-1"><span>Replace settings of this draft network</span><select v-model="networkId" name="sdn-draft-network" class="select select-bordered w-full"><option value="">Choose a draft network</option><option v-for="row in networks" :key="row.id" :value="row.id">{{ row.vnet || row.id }}</option></select></label>
      <p class="text-sm text-base-content/70">This copies the zone and selected network settings into the scenario draft. Review all networks and guest addresses afterward. Backend preflight rechecks compatibility, pending changes and conflicts.</p>
      <button type="button" class="btn btn-outline btn-sm" data-testid="sdn-use" :disabled="!canUse" @click="useSettings">Use these network settings</button>
    </div>
  </details>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n/index.js'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { applyScenarioAllocation, releaseScenarioAllocation, reserveScenarioAllocation, restoreScenarioAllocation } from '@/services/scenarioAllocation'

const props = defineProps({ projectId: { type: String, required: true }, vms: { type: Array, default: () => [] },
  networks: { type: Array, default: () => [] }, targetHostId: { type: String, default: '' } })
const emit = defineEmits(['reserved', 'released'])
const { t } = useI18n()
const backend = useBackendApiStore()
void ensureNamespaces(['allocation'])
const hosts = ref([])
const target = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const reservation = ref(null)
const reviewedSignature = ref('')
const applied = ref(false)
const vmidStart = ref(2000)
const vmidEnd = ref(8999)
const now = ref(Date.now())
let session = 0
let operation = 0
const timer = setInterval(() => { now.value = Date.now() }, 1000)
const signatureFor = vms => JSON.stringify([target.value, props.networks, vms.map(vm => ({ node_id: vm.node_id, vm_id: vm.vm_id, nics: vm.nics }))])
const signature = computed(() => signatureFor(props.vms))
const expired = computed(() => reservation.value && Date.parse(reservation.value.expires_at) <= now.value)
const validTarget = computed(() => hosts.value.some(host => host.id === target.value))
const mappingMatches = computed(() => {
  if (!reservation.value || signature.value !== reviewedSignature.value) return false
  try {
    applyScenarioAllocation(props.vms, reservation.value.assignments)
    return reservation.value.assignments.every(vm => vm.nics.every(nic => {
      const network = props.networks.find(item => item.id === nic.network_id)
      return network && network.vnet === nic.bridge && network.subnet === nic.subnet
    }))
  } catch { return false }
})
const canReserve = computed(() => !busy.value && !loading.value && validTarget.value && props.projectId && props.vms.length && props.networks.length)
const canApply = computed(() => canReserve.value && mappingMatches.value && !expired.value)
const dateTime = value => new Date(value).toLocaleString()
const failure = cause => {
  const known = ['ALLOCATION_OWNERSHIP', 'ALLOCATION_OCCUPIED', 'ALLOCATION_PROTECTED', 'ALLOCATION_POOL_EXHAUSTED', 'ALLOCATION_OCCUPANCY_UNAVAILABLE', 'ALLOCATION_INVALID', 'ALLOCATION_EXPIRED', 'ALLOCATION_BUSY']
  return [known.includes(cause.code) ? t(`allocation.errors.${cause.code}`) : '', cause.message || String(cause),
    ...(cause.details || []).map(detail => `${detail.field}: ${detail.reason}`)].filter(Boolean).join(' ')
}

watch([getBackendScope, () => backend.token, () => props.projectId, () => props.targetHostId], async () => {
  const stamp = ++session
  operation += 1
  hosts.value = []
  target.value = ''
  reservation.value = null
  applied.value = false
  busy.value = false
  loading.value = true
  error.value = ''
  try {
    const loaded = []
    let offset = 0
    while (true) {
      const page = await backendRequest(`/v1/proxmox/hosts?offset=${offset}&limit=100`)
      if (stamp !== session) return
      const items = page.items || []
      if (items.some(host => loaded.some(previous => previous.id === host.id))) throw new Error(t('allocation.hostPageError'))
      loaded.push(...items)
      offset += items.length
      if (!items.length || page.total == null || offset >= page.total) break
    }
    hosts.value = loaded
    target.value = loaded.some(host => host.id === props.targetHostId) ? props.targetHostId : !props.targetHostId && loaded.length === 1 ? loaded[0].id : ''
    if (props.targetHostId && !target.value) error.value = t('allocation.targetMissing')
  } catch (cause) { if (stamp === session) error.value = failure(cause) }
  finally { if (stamp === session) loading.value = false }
}, { immediate: true })

watch(target, async host => {
  const stamp = ++operation
  reservation.value = null
  applied.value = false
  busy.value = false
  if (!host || !props.projectId) return
  busy.value = true
  error.value = ''
  try {
    const result = await restoreScenarioAllocation(props.projectId, host)
    if (stamp !== operation) return
    reservation.value = result
    reviewedSignature.value = signature.value
  } catch (cause) { if (stamp === operation) error.value = failure(cause) }
  finally { if (stamp === operation) busy.value = false }
})

async function reserve() {
  if (!canReserve.value) return
  const stamp = ++operation
  const requestedSignature = signature.value
  busy.value = true
  reservation.value = null
  applied.value = false
  error.value = ''
  try {
    const result = await reserveScenarioAllocation({ projectKey: props.projectId, targetHostId: target.value,
      vms: props.vms, networks: props.networks, vmidStart: vmidStart.value, vmidEnd: vmidEnd.value })
    if (stamp !== operation) return
    reservation.value = result
    reviewedSignature.value = requestedSignature
    now.value = Date.now()
  } catch (cause) { if (stamp === operation) error.value = failure(cause) }
  finally { if (stamp === operation) busy.value = false }
}
watch(signature, value => { if (value !== reviewedSignature.value) applied.value = false })
function apply() {
  if (!canApply.value) return
  const vms = applyScenarioAllocation(props.vms, reservation.value.assignments)
  reviewedSignature.value = signatureFor(vms)
  applied.value = true
  emit('reserved', { reservation: JSON.parse(JSON.stringify(reservation.value)), vms,
    target_host_id: target.value, backend_url: getBackendScope() })
}
async function release() {
  if (!reservation.value || busy.value) return
  const stamp = ++operation
  busy.value = true
  error.value = ''
  try {
    const id = reservation.value.reservation_id
    await releaseScenarioAllocation(props.projectId, target.value, id)
    if (stamp !== operation) return
    reservation.value = null
    applied.value = false
    emit('released', { reservation_id: id, target_host_id: target.value, backend_url: getBackendScope() })
  } catch (cause) { if (stamp === operation) error.value = failure(cause) }
  finally { if (stamp === operation) busy.value = false }
}
onBeforeUnmount(() => { session += 1; operation += 1; clearInterval(timer) })
</script>

<template>
  <section class="border border-base-300 rounded-lg p-4 my-4 space-y-3 min-w-0" aria-labelledby="scenario-allocation-title" :aria-busy="busy || loading">
    <h3 id="scenario-allocation-title" class="font-semibold">{{ t('allocation.title') }}</h3>
    <p class="text-sm text-base-content/70">{{ t('allocation.description') }}</p>
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="form-control gap-1"><span class="text-sm">{{ t('allocation.target') }}</span><select v-model="target" class="select select-bordered w-full" data-testid="allocation-target" :disabled="busy || loading || !!targetHostId"><option value="" disabled>{{ t('allocation.chooseTarget') }}</option><option v-for="host in hosts" :key="host.id" :value="host.id">{{ host.name || host.node_name || host.id }}</option></select></label>
      <label class="form-control gap-1"><span class="text-sm">{{ t('allocation.rangeStart') }}</span><input v-model.number="vmidStart" type="number" min="100" max="999999999" step="1" class="input input-bordered w-full" :disabled="busy" /></label>
      <label class="form-control gap-1"><span class="text-sm">{{ t('allocation.rangeEnd') }}</span><input v-model.number="vmidEnd" type="number" min="100" max="999999999" step="1" class="input input-bordered w-full" :disabled="busy" /></label>
    </div>
    <p class="text-xs text-base-content/70">{{ t('allocation.rangeHint') }}</p>
    <p v-if="!loading && !hosts.length" class="text-sm text-warning">{{ t('allocation.noHosts') }}</p>
    <p v-if="error" role="alert" class="text-sm text-error break-words">{{ error }}</p>
    <p v-if="busy || loading" role="status" class="text-sm">{{ t('allocation.loading') }}</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="allocation-reserve" :disabled="!canReserve" @click="reserve">{{ t(reservation ? 'allocation.renew' : 'allocation.reserve') }}</button>
    <div v-if="reservation" class="space-y-3">
      <p class="text-xs text-base-content/70">{{ t('allocation.expiry', { time: dateTime(reservation.expires_at), checked: dateTime(reservation.checked_at) }) }}</p>
      <p v-if="expired" class="text-sm text-warning">{{ t('allocation.expired') }}</p>
      <p v-else-if="!mappingMatches && !applied" class="text-sm text-warning">{{ t('allocation.changed') }}</p>
      <p v-if="applied" role="status" class="text-sm font-medium">{{ t('allocation.applied') }}</p>
      <table class="table table-sm table-fixed w-full [&_th]:whitespace-normal [&_td]:break-words">
        <caption class="sr-only">{{ t('allocation.mapping') }}</caption>
        <thead><tr><th scope="col" class="w-[30%]">{{ t('allocation.vm') }}</th><th scope="col" class="w-[20%]">{{ t('allocation.vmId') }}</th><th scope="col">{{ t('allocation.addresses') }}</th></tr></thead>
        <tbody><tr v-for="vm in reservation.assignments" :key="vm.node_id">
          <th scope="row" class="break-words">{{ vms.find(row => row.node_id === vm.node_id)?.vm_name || vm.node_id }}</th><td>{{ vm.vm_id }}</td>
          <td><span v-for="nic in vm.nics" :key="nic.index" class="block font-mono text-xs mb-1"><span class="block">net{{ nic.index }} · {{ nic.bridge }}</span><span>{{ nic.ip }}/{{ nic.prefix }}</span></span></td>
        </tr></tbody>
      </table>
      <ul v-if="reservation.limitations?.length" class="text-xs text-base-content/70 list-disc pl-5 space-y-1"><li v-for="item in reservation.limitations" :key="item">{{ item }}</li></ul>
      <p class="text-xs text-base-content/70">{{ t('allocation.ownershipHint') }}</p>
      <div class="flex flex-wrap gap-2"><button type="button" class="btn btn-primary btn-sm" data-testid="allocation-apply" :disabled="!canApply || applied" @click="apply">{{ t('allocation.apply') }}</button><button type="button" class="btn btn-ghost btn-sm" data-testid="allocation-release" :disabled="busy" @click="release">{{ t('allocation.release') }}</button></div>
    </div>
  </section>
</template>

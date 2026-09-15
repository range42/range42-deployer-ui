<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { getBackendScope } from '@/services/backendApi'
import { readDeploymentAllocation, releaseDeploymentAllocation } from '@/services/deploymentAllocations'

const props = defineProps({ deploymentId: { type: String, required: true }, disabled: Boolean })
const { t } = useI18n()
const backend = useBackendApiStore()
const claim = ref(null)
const loading = ref(false)
const releasing = ref(false)
const reviewed = ref(false)
const released = ref(false)
const error = ref('')
let version = 0
const busy = computed(() => loading.value || releasing.value || props.disabled)
const canRelease = computed(() => !!claim.value && reviewed.value && !busy.value)

async function reload() {
  const current = ++version
  reviewed.value = false
  released.value = false
  error.value = ''
  claim.value = null
  loading.value = true
  try {
    const result = await readDeploymentAllocation(props.deploymentId)
    if (current === version) claim.value = result
  } catch (cause) {
    if (current === version) error.value = cause.message
  } finally {
    if (current === version) loading.value = false
  }
}

function review() {
  if (busy.value || !claim.value) return
  error.value = ''
  reviewed.value = true
}

async function release() {
  if (!canRelease.value) return
  const current = version
  const deploymentId = props.deploymentId
  releasing.value = true
  error.value = ''
  try {
    await releaseDeploymentAllocation(deploymentId)
    if (current !== version) return
    claim.value = null
    reviewed.value = false
    const refreshed = await readDeploymentAllocation(deploymentId)
    if (current !== version) return
    claim.value = refreshed
    released.value = refreshed === null
  } catch (cause) {
    if (current === version) error.value = cause.message
  } finally {
    if (current === version) releasing.value = false
  }
}

watch([() => props.deploymentId, getBackendScope, () => backend.token], () => {
  releasing.value = false
  void reload()
}, { immediate: true, flush: 'sync' })
watch(() => props.disabled, disabled => { if (disabled) reviewed.value = false })
onBeforeUnmount(() => { version += 1 })
</script>

<template>
  <section class="rounded-xl border border-base-300 p-4 mb-4 space-y-4" data-testid="deployment-allocations" aria-labelledby="deployment-allocations-heading">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0"><h2 id="deployment-allocations-heading" class="font-semibold">{{ t('deployment.allocations.title') }}</h2>
        <p class="text-sm text-base-content/70 mt-1">{{ t('deployment.allocations.description') }}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="loading || releasing" @click="reload">{{ t(loading ? 'deployment.allocations.loading' : 'deployment.allocations.refresh') }}</button>
    </header>
    <p v-if="error" role="alert" class="alert alert-error text-sm break-words" data-testid="allocation-error">{{ error }}</p>
    <p v-if="loading" role="status" class="text-sm">{{ t('deployment.allocations.loading') }}</p>
    <p v-else-if="!claim && !error && !releasing" role="status" class="text-sm" data-testid="allocation-absent">{{ t(released ? 'deployment.allocations.released' : 'deployment.allocations.absent') }}</p>
    <template v-if="claim">
      <dl class="text-sm space-y-1">
        <div><dt class="inline font-medium">{{ t('deployment.allocations.target') }}: </dt><dd class="inline break-all">{{ claim.node_name }} · {{ claim.host_id }}</dd></div>
        <div><dt class="inline font-medium">{{ t('deployment.allocations.revision') }}: </dt><dd class="inline"><code class="break-all">{{ claim.project_sha }}</code></dd></div>
        <div><dt class="inline font-medium">{{ t('deployment.allocations.created') }}: </dt><dd class="inline"><time :datetime="claim.created_at">{{ new Date(claim.created_at).toLocaleString() }}</time></dd></div>
      </dl>
      <ul class="space-y-2">
        <li v-for="vm in claim.assignments" :key="vm.vm_id" class="rounded-lg bg-base-200/60 p-3 min-w-0">
          <p class="text-sm font-medium break-words">{{ vm.vm_name || t('deployment.allocations.unnamed') }} · {{ vm.vm_id }}</p>
          <p v-for="nic in vm.nics" :key="nic.index" class="text-sm break-all mt-1">net{{ nic.index }} · {{ nic.bridge }} · {{ nic.ip }}</p>
          <p v-if="!vm.nics.length" class="text-sm mt-1">{{ t('deployment.allocations.noAddresses') }}</p>
        </li>
      </ul>
      <p v-if="disabled" role="status" class="text-sm border-l-2 border-warning pl-2" data-testid="allocation-busy-reason">{{ t('deployment.allocations.busy') }}</p>
      <button v-if="!reviewed" type="button" class="btn btn-outline btn-sm" data-testid="allocation-review-release" :disabled="busy" @click="review">{{ t('deployment.allocations.review') }}</button>
      <div v-else class="rounded-lg border border-base-300 p-4 space-y-3" data-testid="allocation-release-review">
        <h3 class="font-semibold">{{ t('deployment.allocations.confirmTitle') }}</h3>
        <p class="text-sm">{{ t('deployment.allocations.confirmDescription') }}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-error btn-outline btn-sm" data-testid="allocation-confirm-release" :disabled="!canRelease" @click="release">{{ t(releasing ? 'deployment.allocations.releasing' : 'deployment.allocations.confirm') }}</button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="releasing" @click="reviewed = false">{{ t('deployment.allocations.cancel') }}</button>
        </div>
      </div>
    </template>
  </section>
</template>

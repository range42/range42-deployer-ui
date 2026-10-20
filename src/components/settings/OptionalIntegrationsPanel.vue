<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

type Capability = {optional: boolean; configuration_state: string;
  required_for_environment_deployment: boolean; provider_access_verified: boolean}
const backend = useBackendApiStore()
const busy = ref(false), error = ref(''), state = ref('')
let epoch = 0, controller: AbortController | null = null
function reset() {
  epoch++; controller?.abort(); controller = null
  state.value = ''; error.value = ''; busy.value = false
}
watch(() => JSON.stringify([backend.activeHost?.id, getBackendScope(), backend.token]), reset, {flush: 'sync'})
onBeforeUnmount(reset)
async function refresh() {
  if (busy.value) return
  const current = ++epoch
  busy.value = true; error.value = ''; state.value = ''; controller = new AbortController()
  try {
    const identity = await backendRequest<{role: string}>('/v1/auth/me', {signal: controller.signal})
    if (current !== epoch) return
    if (identity.role !== 'admin') throw new Error('Administrator access is required to review installation integrations.')
    const result = await backendRequest<Capability>('/v1/integrations/identity', {signal: controller.signal})
    if (current !== epoch) return
    if (result.optional !== true || result.required_for_environment_deployment !== false
      || result.provider_access_verified !== false
      || !['configured', 'not_configured', 'invalid_configuration'].includes(result.configuration_state)) {
      throw new Error('The backend returned an unsupported integration review. Refresh after checking the backend version.')
    }
    state.value = result.configuration_state
  } catch (cause) {
    if (current === epoch) error.value = cause instanceof Error ? cause.message : 'Could not review optional integrations.'
  } finally { if (current === epoch) busy.value = false }
}
</script>

<template>
  <section class="space-y-4 rounded-xl border border-base-300 p-5" data-testid="optional-integrations-panel" aria-labelledby="optional-integrations-title">
    <h2 id="optional-integrations-title" class="text-xl font-semibold">Optional integrations</h2>
    <p class="text-sm">Environment deployment does not require managed onboarding. Use identity and network integrations when this installation needs automatic account and laptop access management.</p>
    <p class="text-sm">The installation administrator configures approved integrations on the backend. Saved workshop groups and resource ownership remain independent of the selected providers.</p>
    <button type="button" class="btn btn-outline btn-sm" data-testid="integration-refresh" :disabled="busy" @click="refresh">{{ busy ? 'Reviewing…' : 'Review integration settings' }}</button>
    <p v-if="busy" role="status">Reading installation configuration…</p>
    <p v-if="error" role="alert" class="rounded border border-error p-3">{{ error }}</p>
    <div v-if="state" data-testid="integration-state" class="space-y-2 rounded border border-base-300 p-3" role="status">
      <p>Managed onboarding: <strong>{{ state === 'not_configured' ? 'Not configured' : state === 'configured' ? 'Configured' : 'Configuration needs attention' }}</strong></p>
      <p class="text-sm">Account provisioning and laptop access have not been verified. Configuration status does not confirm provider health, access grants or network isolation.</p>
    </div>
  </section>
</template>

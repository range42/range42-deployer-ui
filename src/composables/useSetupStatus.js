import { computed } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

/**
 * First-run / onboarding status.
 *
 * Setup is "complete enough" to stop nagging once the user has registered at
 * least one Git source AND one backend-api host. Having projects is NOT
 * required — a user can always create one regardless of setup state.
 *
 * Note: this intentionally does NOT read the legacy global proxmoxSettingsStore
 * (the orphaned single-host store). The real per-project connection is a
 * backend-api host selection (see useProxmoxSettings / backendApiStore).
 */
export function useSetupStatus() {
  const inv = useInventoryStore()
  const backend = useBackendApiStore()

  const hasSource = computed(() => inv.sources.length > 0)
  const hasBackendHost = computed(() => backend.hosts.length > 0)
  const setupComplete = computed(() => hasSource.value && hasBackendHost.value)

  return { hasSource, hasBackendHost, setupComplete }
}

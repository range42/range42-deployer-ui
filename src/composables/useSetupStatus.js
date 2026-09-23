import { computed } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore.ts'

/**
 * First-run / onboarding status.
 *
 * Setup is complete once a repository has been indexed on the selected
 * backend. Browser-only source records do not prove the backend can read it.
 * A project is not required — users can create one throughout setup.
 *
 * Note: this intentionally does NOT read the legacy global proxmoxSettingsStore
 * (the orphaned single-host store). The real per-project connection is a
 * backend-api host selection (see useProxmoxSettings / backendApiStore).
 */
export function useSetupStatus() {
  const inv = useInventoryStore()
  const backend = useBackendApiStore()

  const hasSource = computed(() =>
    inv.sourcesBackendScope === backend.url &&
    inv.sources.some((source) => source.repos?.some((repo) => repo.last_refreshed_at)),
  )
  const hasBackendHost = computed(() => backend.hosts.length > 0)
  const setupComplete = computed(() => hasSource.value && hasBackendHost.value)

  return { hasSource, hasBackendHost, setupComplete }
}

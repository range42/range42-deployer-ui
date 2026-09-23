import { onScopeDispose, ref, watch } from 'vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import type { DeploymentRecord } from '@/types/range42-schema'

/** Paginated deployment records are scoped to the currently selected backend. */
export function useDeploymentIndex() {
  const backend = useBackendApiStore()
  const items = ref<DeploymentRecord[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let version = 0

  async function load() {
    const request = ++version
    loading.value = true
    error.value = null
    try {
      const loaded: DeploymentRecord[] = []
      let offset = 0
      while (true) {
        const page = await backendRequest<{ items: DeploymentRecord[]; total: number }>(
          `/v1/deployments?offset=${offset}&limit=100`,
        )
        if (request !== version) return
        loaded.push(...page.items)
        offset += page.items.length
        if (!page.items.length || offset >= page.total) break
      }
      items.value = loaded
    } catch (reason) {
      if (request === version) {
        items.value = []
        error.value = reason instanceof Error ? reason.message : String(reason)
      }
    } finally {
      if (request === version) loading.value = false
    }
  }

  watch([getBackendScope, () => backend.token], () => {
    items.value = []
    void load()
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { version += 1 })
  return { items, loading, error, load }
}

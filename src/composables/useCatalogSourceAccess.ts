import { onMounted, ref, watch } from 'vue'
import { useCatalogSources } from '@/composables/useCatalogSources'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useInventoryStore } from '@/stores/inventoryStore'

/** Hydrate backend source registrations before offering source-dependent actions. */
export function useCatalogSourceAccess() {
  const backend = useBackendApiStore()
  const inventory = useInventoryStore()
  const { loadSources } = useCatalogSources()
  const ready = ref(false), loading = ref(false), error = ref('')
  let generation = 0
  async function reload() {
    const current = ++generation
    ready.value = false; loading.value = true; error.value = ''
    try {
      await loadSources()
      if (current === generation) ready.value = true
    } catch (cause) {
      if (current === generation) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally { if (current === generation) loading.value = false }
  }
  watch(() => [backend.url, backend.token], reload)
  onMounted(reload)
  return { loading, error, reload, available: (id: string) => ready.value && !!inventory.getSource(id) }
}

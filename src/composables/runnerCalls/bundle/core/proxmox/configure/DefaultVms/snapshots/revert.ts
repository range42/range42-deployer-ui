


import { ref, computed } from 'vue'
import { 
  useProxmoxSettings, 
  normalizeBackendApiUrl, 
  DEFAULT_BACKEND_API_URL 
} from '@/composables/useProxmoxSettings'

// API endpoint path for snapshot bundle operations
const BUNDLE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default/snapshot'
const DEFAULT_VM_SNAPSHOT_NAME = 'this-default-snapshot-name'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)
  const current_action = ref<null | 'vm_snapshot_revert'>(null)

  // Get project-specific settings from the settings store
  const settings = projectId ? useProxmoxSettings(projectId) : null
  
  // Compute API base URL from settings
  const apiBaseUrl = computed(() => {
    const url = settings?.backendApiUrl?.value || settings?.baseUrl?.value
    return url ? normalizeBackendApiUrl(url) : DEFAULT_BACKEND_API_URL
  })
  
  // Full endpoint URL
  const endpointBase = computed(() => `${apiBaseUrl.value}${BUNDLE_PATH}`)
  
  // Proxmox node from settings
  const proxmoxNode = computed(() => 
    settings?.proxmoxNode?.value || settings?.defaultNode?.value || ''
  )


  //
  async function call_post(url: string, payload: object) {

    const res = await fetch(url, {

      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),

    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    return res.json()
  }

  //

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
    target_infrastructure_group: string,
    nodeOverride?: string) {

    loading.value = true
    error.value = null
    current_action.value = "vm_snapshot_revert"

    try {
      // Check if settings are configured
      if (!settings?.isConfigured?.value) {
        throw new Error('[Settings] Backend API settings not configured. Please configure Backend API URL and Proxmox Node in project settings.')
      }

      const node = nodeOverride || proxmoxNode.value
      if (!node) {
        throw new Error('[Settings] Proxmox node not specified. Please configure in project settings.')
      }
      
      const current_endpoint = `${endpointBase.value}/revert-vms-${target_infrastructure_group}`

      return await call_post(current_endpoint, { as_json: true, proxmox_node: node, vm_snapshot_name: DEFAULT_VM_SNAPSHOT_NAME })

    } catch (e: any) {

      error.value = e?.message || 'Something went wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
      'student',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  return {
    useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms,
    handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotAdmin,
    handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotStudent,
    handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotVuln,
    //
    current_action, // status variable to block UI during processing and allow us to identify where enable the spinner.
    loading,
    error
  }
}

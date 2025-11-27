


import { ref, computed } from 'vue'
import { 
  useProxmoxSettings, 
  normalizeBackendApiUrl, 
  DEFAULT_BACKEND_API_URL 
} from '@/composables/useProxmoxSettings'

// API endpoint path for bundle operations
const BUNDLE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)
  const current_action = ref<null | 'delete'>(null)

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
  async function call_delete(url: string, payload: object) {

    const res = await fetch(url, {

      method: 'DELETE',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),

    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    return res.json()
  }

  //
  async function handleBundleCoreProxmoxConfigureDefaultDelete_vmsTarget(
    target_infrastructure_group: string,
    nodeOverride?: string) {

    loading.value = true
    error.value = null
    current_action.value = "delete"

    try {
      // Check if settings are configured
      if (!settings?.isConfigured?.value) {
        throw new Error('⚙️ Backend API settings not configured. Please configure Backend API URL and Proxmox Node in project settings.')
      }

      const node = nodeOverride || proxmoxNode.value
      if (!node) {
        throw new Error('⚙️ Proxmox node not specified. Please configure in project settings.')
      }
      
      const current_endpoint = `${endpointBase.value}/delete-vms-${target_infrastructure_group}`

      return await call_delete(current_endpoint, { as_json: true, proxmox_node: node })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_deleteVmsVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultDelete_vmsTarget(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_deleteVmsAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultDelete_vmsTarget(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_deleteVmsStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultDelete_vmsTarget(
      'student',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  return {
    useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms,
    //
    handleBundleCoreProxmoxConfigureDefault_deleteVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_deleteVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_deleteVmsVuln,
    //
    current_action, // status variable to block UI during processing and allow us to identify where enable the spinner.
    loading,
    error
  }
}

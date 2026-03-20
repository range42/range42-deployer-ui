


import { ref, computed } from 'vue'
import { 
  useProxmoxSettings, 
  normalizeBackendApiUrl, 
  DEFAULT_BACKEND_API_URL 
} from '@/composables/useProxmoxSettings'

// API endpoint path for bundle operations
const BUNDLE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default'

// // // //



export function useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)
  const current_action = ref<null | 'start' | 'stop' | 'pause' | 'resume'>(null)

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
  async function post(url: string, payload: object) {

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
  async function handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget(
    action: string,
    target_infrastructure_group: string,
    nodeOverride?: string) {

    loading.value = true
    error.value = null
    current_action.value = action as any

    try {
      // Check if settings are configured
      if (!settings?.isConfigured?.value) {
        throw new Error('[Settings] Backend API settings not configured. Please configure Backend API URL and Proxmox Node in project settings.')
      }

      const node = nodeOverride || proxmoxNode.value
      if (!node) {
        throw new Error('[Settings] Proxmox node not specified. Please configure in project settings.')
      }
      
      const current_endpoint = `${endpointBase.value}/${action}-vms-${target_infrastructure_group}`

      return await post(current_endpoint, { as_json: true, proxmox_node: node })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }


  async function handleBundleCoreProxmoxConfigureDefault_startVmsVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget(
      'start',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_stopVmsVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_pauseVmsVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_resumeVmsVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'vuln',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_startVmsAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('start',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_stopVmsAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_pauseVmsAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_resumeVmsAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'admin',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_startVmsStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('start',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_stopVmsStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_pauseVmsStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_resumeVmsStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'student',
      node
    )
  }


  return {
    useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume,
    //
    handleBundleCoreProxmoxConfigureDefault_startVmsVuln,
    handleBundleCoreProxmoxConfigureDefault_stopVmsVuln,
    handleBundleCoreProxmoxConfigureDefault_pauseVmsVuln,
    handleBundleCoreProxmoxConfigureDefault_resumeVmsVuln,
    //
    handleBundleCoreProxmoxConfigureDefault_startVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_stopVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_pauseVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_resumeVmsAdmin,
    //
    handleBundleCoreProxmoxConfigureDefault_startVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_stopVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_pauseVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_resumeVmsStudent,
    current_action,
    loading,
    error
  }
}

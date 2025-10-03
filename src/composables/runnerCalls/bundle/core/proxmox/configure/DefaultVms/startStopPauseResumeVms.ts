


import { ref, computed } from 'vue'
import { useProxmoxSettings, normalizeProxmoxBaseUrl, DEFAULT_PROXMOX_BASE_DOMAIN } from '@/composables/useProxmoxSettings'

// Fallback constants (used only if project settings not configured)
const FALLBACK_DOMAIN = DEFAULT_PROXMOX_BASE_DOMAIN
const BASE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default'
const FALLBACK_DEFAULT_NODE = 'px-testing'

// // // //



export function useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'start' | 'stop' | 'pause' | 'resume'>(null)

  // Get project-specific settings
  const proxmoxSettings = projectId ? useProxmoxSettings(projectId) : null
  const baseDomain = computed(() => proxmoxSettings?.baseUrl?.value
    ? normalizeProxmoxBaseUrl(proxmoxSettings.baseUrl.value)
    : FALLBACK_DOMAIN)
  const BASE = computed(() => `${baseDomain.value}${BASE_PATH}`)
  const DEFAULT_NODE = computed(() => proxmoxSettings?.defaultNode?.value || FALLBACK_DEFAULT_NODE)


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
    proxmoxNode?: string) {

    loading.value = true
    error.value = null
    current_action.value = action as any

    try {
      // Check if Proxmox settings are configured
      if (!proxmoxSettings?.isConfigured?.value) {
        throw new Error('⚙️ Proxmox settings not configured. Please configure Base Domain and Default Node in project settings.')
      }

      const node = proxmoxNode || DEFAULT_NODE.value
      const current_endpoint = `${BASE.value}/${action}-vms-${target_infrastructure_group}`

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

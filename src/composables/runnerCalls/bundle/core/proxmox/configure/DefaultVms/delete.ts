


import { ref, computed } from 'vue'
import { useProxmoxSettings, normalizeProxmoxBaseUrl, DEFAULT_PROXMOX_BASE_DOMAIN } from '@/composables/useProxmoxSettings'

// Fallback constants (used only if project settings not configured)
const FALLBACK_DOMAIN = DEFAULT_PROXMOX_BASE_DOMAIN
const BASE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default'
const FALLBACK_DEFAULT_NODE = 'px-testing'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'delete'>(null)

  // Get project-specific settings
  const proxmoxSettings = projectId ? useProxmoxSettings(projectId) : null
  const baseDomain = computed(() => proxmoxSettings?.baseUrl?.value
    ? normalizeProxmoxBaseUrl(proxmoxSettings.baseUrl.value)
    : FALLBACK_DOMAIN)
  const BASE = computed(() => `${baseDomain.value}${BASE_PATH}`)
  const DEFAULT_NODE = computed(() => proxmoxSettings?.defaultNode?.value || FALLBACK_DEFAULT_NODE)


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
    proxmoxNode?: string) {

    loading.value = true
    error.value = null
    current_action.value = "delete" // as any

    try {
      // Check if Proxmox settings are configured
      if (!proxmoxSettings?.isConfigured?.value) {
        throw new Error('⚙️ Proxmox settings not configured. Please configure Base Domain and Default Node in project settings.')
      }

      const node = proxmoxNode || DEFAULT_NODE.value
      const current_endpoint = `${BASE.value}/delete-vms-${target_infrastructure_group}`

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

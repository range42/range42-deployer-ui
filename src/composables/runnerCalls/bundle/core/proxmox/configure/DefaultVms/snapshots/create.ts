


import { ref, computed } from 'vue'
import { useProxmoxSettings, normalizeProxmoxBaseUrl, DEFAULT_PROXMOX_BASE_DOMAIN } from '@/composables/useProxmoxSettings'

// Fallback constants (used only if project settings not configured)
const FALLBACK_DOMAIN = DEFAULT_PROXMOX_BASE_DOMAIN
const BASE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default/snapshot'
const FALLBACK_DEFAULT_NODE = 'px-testing'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'vm_snapshot_create'>(null)

  // Get project-specific settings
  const proxmoxSettings = projectId ? useProxmoxSettings(projectId) : null
  const baseDomain = computed(() => proxmoxSettings?.baseUrl?.value
    ? normalizeProxmoxBaseUrl(proxmoxSettings.baseUrl.value)
    : FALLBACK_DOMAIN)
  const BASE = computed(() => `${baseDomain.value}${BASE_PATH}`)
  const DEFAULT_NODE = computed(() => proxmoxSettings?.defaultNode?.value || FALLBACK_DEFAULT_NODE)


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
  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createVmsTarget(
    target_infrastructure_group: string,
    proxmoxNode?: string) {
    loading.value = true
    error.value = null
    current_action.value = "vm_snapshot_create" // as any

    try {
      // Check if Proxmox settings are configured
      if (!proxmoxSettings?.isConfigured?.value) {
        throw new Error('⚙️ Proxmox settings not configured. Please configure Base Domain and Default Node in project settings.')
      }

      const node = proxmoxNode || DEFAULT_NODE.value
      const current_endpoint = `${BASE.value}/create-vms-${target_infrastructure_group}`

      return await call_post(current_endpoint, { as_json: true, proxmox_node: node })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultSnapshot_createVmsTarget(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultSnapshot_createVmsTarget(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultSnapshot_createVmsTarget(
      'student',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  return {
    useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms,
    //
    handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotAdmin,
    handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotStudent,
    handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotVuln,
    //
    current_action, // status variable to block UI during processing and allow us to identify where enable the spinner.
    loading,
    error
  }
}

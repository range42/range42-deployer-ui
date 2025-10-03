


import { ref, computed } from 'vue'
import { useProxmoxSettings, normalizeProxmoxBaseUrl, DEFAULT_PROXMOX_BASE_DOMAIN } from '@/composables/useProxmoxSettings'

// Fallback constants (used only if project settings not configured)
const FALLBACK_DOMAIN = DEFAULT_PROXMOX_BASE_DOMAIN
const BASE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default/snapshot'
const FALLBACK_DEFAULT_NODE = 'px-testing'
const DEFAULT_VM_SNAPSHOT_NAME = 'this-default-snapshot-name'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'vm_snapshot_revert'>(null)

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

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
    target_infrastructure_group: string,
    proxmoxNode?: string) {

    loading.value = true
    error.value = null
    current_action.value = "vm_snapshot_revert" // as any

    try {
      // Check if Proxmox settings are configured
      if (!proxmoxSettings?.isConfigured?.value) {
        throw new Error('⚙️ Proxmox settings not configured. Please configure Base Domain and Default Node in project settings.')
      }

      const node = proxmoxNode || DEFAULT_NODE.value
      const current_endpoint = `${BASE.value}/revert-vms-${target_infrastructure_group}`

      return await call_post(current_endpoint, { as_json: true, proxmox_node: node, vm_snapshot_name: DEFAULT_VM_SNAPSHOT_NAME })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
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

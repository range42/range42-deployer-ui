


import { ref } from 'vue'


const BASE = `http://127.0.0.1:8000/v0/admin/run/bundles/core/proxmox/configure/default`
const DEFAULT_NODE = 'px-testing'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVms_deleteTargetVms() {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'delete'>(null)


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
    proxmoxNode: string = DEFAULT_NODE) {

    loading.value = true
    error.value = null
    current_action.value = "delete" // as any

    try {
      const current_endpoint = `${BASE}/delete-vms-${target_infrastructure_group}`

      return await call_delete(current_endpoint, { as_json: true, proxmox_node: proxmoxNode })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_deleteVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultDelete_vmsTarget(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_deleteVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultDelete_vmsTarget(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_deleteVmsStudent(node = DEFAULT_NODE) {

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

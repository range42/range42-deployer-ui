


import { ref } from 'vue'


const BASE = `http://127.0.0.1:8000/v0/admin/run/bundles/core/proxmox/configure/default/snapshot`
const DEFAULT_NODE = 'px-testing'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVmsSnapshot_createSnapshotTargetVms() {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'vm_snapshot_create'>(null)


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
    proxmoxNode: string = DEFAULT_NODE) {

    loading.value = true
    error.value = null
    current_action.value = "vm_snapshot_create" // as any

    try {
      const current_endpoint = `${BASE}/create-vms-${target_infrastructure_group}`

      return await call_post(current_endpoint, { as_json: true, proxmox_node: proxmoxNode })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultSnapshot_createVmsTarget(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultSnapshot_createVmsTarget(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultSnapshot_createSnapshotStudent(node = DEFAULT_NODE) {

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

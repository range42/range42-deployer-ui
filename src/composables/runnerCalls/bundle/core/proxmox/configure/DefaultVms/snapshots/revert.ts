


import { ref } from 'vue'


const BASE = `http://127.0.0.1:8000/v0/admin/run/bundles/core/proxmox/configure/default/snapshot`
const DEFAULT_NODE = 'px-testing'
const DEFAULT_VM_SNAPSHOT_NAME = 'this-default-snapshot-name'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms() {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'vm_snapshot_revert'>(null)


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
    proxmoxNode: string = DEFAULT_NODE) {

    loading.value = true
    error.value = null
    current_action.value = "vm_snapshot_revert" // as any

    try {
      const current_endpoint = `${BASE}/revert-vms-${target_infrastructure_group}`

      return await call_post(current_endpoint, { as_json: true, proxmox_node: proxmoxNode, vm_snapshot_name: DEFAULT_VM_SNAPSHOT_NAME })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotTargetVms(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultVmsSnapshot_revertSnapshotStudent(node = DEFAULT_NODE) {

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

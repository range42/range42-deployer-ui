


import { ref } from 'vue'


const BASE = `http://127.0.0.1:8000/v0/admin/run/bundles/core/proxmox/configure/default`
// const TARGET_INFRASTRUCTURE_GROUP = "vms" // vuln"
const DEFAULT_NODE = 'px-testing'

// // // //



export function useBundleCoreProxmoxConfigureDefaultVms_startStopPauseResume() {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'start' | 'stop' | 'pause' | 'resume'>(null)


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
    proxmoxNode: string = DEFAULT_NODE) {

    loading.value = true
    error.value = null
    current_action.value = action as any

    try {
      const current_endpoint = `${BASE}/${action}-vms-${target_infrastructure_group}`

      return await post(current_endpoint, { as_json: true, proxmox_node: proxmoxNode })

    } catch (e: any) {

      error.value = e?.message || 'something wrong.'
      throw e

    } finally {

      loading.value = false
      current_action.value = null

    }
  }


  async function handleBundleCoreProxmoxConfigureDefault_startVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget(
      'start',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_stopVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_pauseVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_resumeVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'vuln',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_startVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('start',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_stopVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_pauseVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_resumeVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'admin',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_startVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('start',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_stopVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_pauseVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_resumeVmsStudent(node = DEFAULT_NODE) {

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

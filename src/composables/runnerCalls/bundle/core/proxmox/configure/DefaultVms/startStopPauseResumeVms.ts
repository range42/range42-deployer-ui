


import { ref } from 'vue'


const BASE = `http://127.0.0.1:8000/v0/admin/run/bundles/core/proxmox/configure/default`
// const TARGET_INFRASTRUCTURE_GROUP = "vms" // vuln"
const DEFAULT_NODE = 'px-testing'

// // // //

export function useBundleCoreProxmoxConfigureDefaultVmsTarget_StartStopPauseResume() {

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


  async function handleBundleCoreProxmoxConfigureDefault_StartVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget(
      'start',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_StopVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_PauseVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_ResumeVmsVuln(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'vuln',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_StartVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('start',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_StopVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_PauseVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_ResumeVmsAdmin(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'admin',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefault_StartVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('start',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_StopVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('stop',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_PauseVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('pause',
      'student',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefault_ResumeVmsStudent(node = DEFAULT_NODE) {

    return handleBundleCoreProxmoxConfigureDefaultStartStopPauseResume_VmsTarget('resume',
      'student',
      node
    )
  }


  return {
    useBundleCoreProxmoxConfigureDefaultVmsTarget_StartStopPauseResume,
    //
    handleBundleCoreProxmoxConfigureDefault_StartVmsVuln,
    handleBundleCoreProxmoxConfigureDefault_StopVmsVuln,
    handleBundleCoreProxmoxConfigureDefault_PauseVmsVuln,
    handleBundleCoreProxmoxConfigureDefault_ResumeVmsVuln,
    //
    handleBundleCoreProxmoxConfigureDefault_StartVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_StopVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_PauseVmsAdmin,
    handleBundleCoreProxmoxConfigureDefault_ResumeVmsAdmin,
    //
    handleBundleCoreProxmoxConfigureDefault_StartVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_StopVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_PauseVmsStudent,
    handleBundleCoreProxmoxConfigureDefault_ResumeVmsStudent,
    current_action,
    loading,
    error
  }
}

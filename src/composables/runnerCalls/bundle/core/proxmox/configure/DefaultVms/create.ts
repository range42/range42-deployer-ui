import { ref, computed } from 'vue'
import { useProxmoxSettings, normalizeProxmoxBaseUrl, DEFAULT_PROXMOX_BASE_DOMAIN } from '@/composables/useProxmoxSettings'

// Fallback constants (used only if project settings not configured)
const FALLBACK_DOMAIN = DEFAULT_PROXMOX_BASE_DOMAIN
const BASE_PATH = '/v0/admin/run/bundles/core/proxmox/configure/default'
const FALLBACK_DEFAULT_NODE = 'px-testing'

const DEFAULT_VMS: Record<string, any> = {
  // "proxmox_node": "px-testing",
  // "vms": {
  admin: {   // not following the schema !
    "admin-wazuh": {
      vm_description: "Wazuh - dashboard",
      vm_id: 1000,
      vm_ip: "192.168.42.100"
    },
    "admin-web-api-kong": {
      vm_description: "API gateway",
      vm_id: 1020,
      vm_ip: "192.168.42.120"
    },
    "admin-web-builder-api": {
      vm_description: "www - backend API",
      vm_id: 1021,
      vm_ip: "192.168.42.121"
    },
    "admin-web-deployer-ui": {
      vm_description: "www - front end - r42 - deployer -ui",
      vm_id: 1023,
      vm_ip: "192.168.42.123"
    },
    "admin-web-emp": {
      vm_description: "www - front end - r42 - EMP",
      vm_id: 1022,
      vm_ip: "192.168.42.122"
    }
  },

  // "proxmox_node": "px-testing",
  // "vms": {
  vuln: { // not following the schema !

    "vuln-box-00": {
      "vm_description": "vulnerable vm 00",
      "vm_id": 4000,
      "vm_ip": "192.168.42.170"
    },
    "vuln-box-01": {
      "vm_description": "vulnerable vm 01",
      "vm_id": 4001,
      "vm_ip": "192.168.42.171"
    },
    "vuln-box-02": {
      "vm_description": "vulnerable vm 02",
      "vm_id": 4002,
      "vm_ip": "192.168.42.172"
    },
    "vuln-box-03": {
      "vm_description": "vulnerable vm 03",
      "vm_id": 4003,
      "vm_ip": "192.168.42.173"
    },
    "vuln-box-04": {
      "vm_description": "vulnerable vm 04",
      "vm_id": 4004,
      "vm_ip": "192.168.42.174"
    }
  },
  // "proxmox_node": "px-testing",
  // "vms": {
  "student": { // not following the schema !
    "student-box-01": {
      "vm_description": "student R42 student vm",
      "vm_id": 3001,
      "vm_ip": "192.168.42.160"
    }
  }
  // }
}

// // // //

export function useBundleCoreProxmoxConfigureDefaultVms_createTargetVms(projectId?: any) {

  const loading = ref(false)
  const error = ref<string | null>(null)

  const current_action = ref<null | 'create'>(null)

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
  async function handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsTarget(
    target_infrastructure_group: string,
    proxmoxNode?: string
  ) {
    loading.value = true
    error.value = null
    current_action.value = "create" //  as any

    try {
      // Check if Proxmox settings are configured
      if (!proxmoxSettings?.isConfigured?.value) {
        throw new Error('⚙️ Proxmox settings not configured. Please configure Base Domain and Default Node in project settings.')
      }

      const node = proxmoxNode || DEFAULT_NODE.value
      const vms = DEFAULT_VMS[target_infrastructure_group]
      const body = { as_json: true, proxmox_node: node, vms }

      return await call_post(`${BASE.value}/create-vms-${target_infrastructure_group}`, body)

    } catch (e: any) {

      error.value = e?.message || "something wrong."
      throw e

    } finally {

      loading.value = false
      current_action.value = null
    }
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  async function handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsVuln(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsTarget(
      'vuln',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsAdmin(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsTarget(
      'admin',
      node
    )
  }

  async function handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsStudent(node?: string) {

    return handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsTarget(
      'student',
      node
    )
  }

  // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //

  return {
    useBundleCoreProxmoxConfigureDefaultVms_createTargetVms,
    //
    handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsAdmin,
    handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsVuln,
    handleBundleCoreProxmoxConfigureDefaultVmsTarget_createVmsStudent,



    //
    current_action, // status variable to block UI during processing and allow us to identify where enable the spinner.
    loading,
    error
  }
}

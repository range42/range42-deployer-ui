/**
 * Proxmox Data Cache
 *
 * Shared cache for VM list and template data.
 * Avoids redundant API calls across ConfigPanel, import modal, and status polling.
 * Cache auto-expires after TTL. Manual refresh available.
 */

import { ref, computed } from 'vue'
import { proxmoxApi } from './api'
import type { VmListItem, ProxmoxNode } from './types'

const CACHE_TTL_MS = 60_000 // 1 minute

// Shared state
const vmCache = ref<VmListItem[]>([])
const lastFetchedAt = ref(0)
const isFetching = ref(false)
const fetchError = ref<string | null>(null)
let currentNode: string = ''

// Derived
const templates = computed(() => vmCache.value.filter(v => v.isTemplate))
const runningVms = computed(() => vmCache.value.filter(v => !v.isTemplate && v.status !== 'stopped'))
const allVms = computed(() => vmCache.value.filter(v => !v.isTemplate))

function isCacheValid(): boolean {
  return vmCache.value.length > 0 && Date.now() - lastFetchedAt.value < CACHE_TTL_MS
}

async function fetchVms(node: ProxmoxNode, force = false): Promise<VmListItem[]> {
  if (!force && isCacheValid() && currentNode === node) {
    return vmCache.value
  }

  if (isFetching.value) {
    // Wait for in-flight request
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (!isFetching.value) { clearInterval(check); resolve() }
      }, 100)
    })
    return vmCache.value
  }

  try {
    isFetching.value = true
    fetchError.value = null
    currentNode = node
    const vms = await proxmoxApi.vm.list(node)
    vmCache.value = vms
    lastFetchedAt.value = Date.now()
    return vms
  } catch (e) {
    fetchError.value = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    isFetching.value = false
  }
}

function getTemplateOptions(): { value: string; label: string }[] {
  return templates.value
    .sort((a, b) => a.vmid - b.vmid)
    .map(v => {
      const ram = v.maxmem ? Math.floor(v.maxmem / 1024 / 1024) : 0
      const ramLabel = ram >= 1024 ? `${(ram / 1024).toFixed(0)}GB` : `${ram}MB`
      const cores = v.maxcpu || '?'
      return {
        value: String(v.vmid),
        label: `${v.name} — ${cores} cores, ${ramLabel}`,
      }
    })
}

function invalidate(): void {
  lastFetchedAt.value = 0
}

export const proxmoxCache = {
  // State
  vmCache,
  isFetching,
  fetchError,
  lastFetchedAt,

  // Computed
  templates,
  runningVms,
  allVms,

  // Actions
  fetchVms,
  getTemplateOptions,
  invalidate,
  isCacheValid,
}

export default proxmoxCache

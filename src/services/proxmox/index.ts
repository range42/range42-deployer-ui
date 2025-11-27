/**
 * Proxmox Service - Barrel Export
 * 
 * Re-exports all types and API functions for clean imports:
 * 
 * import { proxmoxApi, VmCreateRequest } from '@/services/proxmox'
 */

// Re-export all types
export * from './types'

// Re-export API client
export { 
  proxmoxApi,
  setBaseUrl,
  getBaseUrl,
  vm,
  snapshot,
  lxc,
  network,
  firewall,
  storage,
} from './api'

// Default export
export { default } from './api'

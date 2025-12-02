/**
 * Proxmox API Types
 * 
 * Type definitions for all Proxmox backend API interactions.
 * These types map to the backend-api Pydantic schemas.
 */

// =============================================================================
// Common Types
// =============================================================================

export type ProxmoxNode = string // e.g., 'pve', 'node1'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  details?: string
}

export interface ApiError {
  status: number
  message: string
  details?: string
}

// =============================================================================
// VM Types
// =============================================================================

export interface VmCreateRequest {
  proxmox_node: ProxmoxNode
  vm_id: number
  vm_name: string
  vm_cpu: string // e.g., 'host', 'kvm64'
  vm_cores: number
  vm_sockets: number
  vm_memory: number // MB
  vm_disk_size?: string // e.g., '32G'
  vm_iso?: string // ISO path
  vm_template?: string // Template to clone from
}

export interface VmConfig {
  vmid: number
  name: string
  cores: number
  sockets: number
  memory: number
  status: VmStatus
  cpu?: string
  disk?: string
  net?: Record<string, string>
  tags?: string[]
}

export type VmStatus = 'running' | 'stopped' | 'paused' | 'unknown'

export interface VmListItem {
  vmid: number
  name: string
  status: VmStatus
  mem: number
  maxmem: number
  cpu: number
  maxcpu: number
  uptime: number
  node: ProxmoxNode
}

export interface VmActionRequest {
  proxmox_node: ProxmoxNode
  vm_id: number
}

export interface VmCloneRequest extends VmActionRequest {
  new_vm_id: number
  new_vm_name: string
  full_clone?: boolean
}

export interface VmSnapshotRequest extends VmActionRequest {
  snapshot_name: string
  description?: string
  include_ram?: boolean
}

// =============================================================================
// LXC Container Types
// =============================================================================

export interface LxcCreateRequest {
  proxmox_node: ProxmoxNode
  vm_id: number
  hostname: string
  ostemplate: string // e.g., 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst'
  cores?: number
  memory?: number // MB
  swap?: number // MB
  rootfs_size?: string // e.g., '8G'
  net0?: string // Network config
  password?: string
  ssh_public_keys?: string
  unprivileged?: boolean
}

export interface LxcConfig {
  vmid: number
  hostname: string
  status: VmStatus
  cores: number
  memory: number
  swap: number
  rootfs: string
  net0?: string
  tags?: string[]
}

// =============================================================================
// Network Types
// =============================================================================

export interface NetworkInterface {
  iface: string // e.g., 'net0', 'net1'
  bridge: string // e.g., 'vmbr0', 'vmbr100'
  model?: string // e.g., 'virtio', 'e1000'
  tag?: number // VLAN tag
  firewall?: boolean
  mac?: string
  rate?: number // Rate limit in MB/s
}

export interface VmNetworkAddRequest {
  proxmox_node: ProxmoxNode
  vm_id: number
  iface_id?: number // 0-31, defaults to next available
  iface_model?: string // 'virtio' | 'e1000' | 'rtl8139'
  iface_bridge: string // e.g., 'vmbr100'
  iface_tag?: number // VLAN tag
  iface_firewall?: boolean
  iface_mac?: string
}

export interface NodeNetworkAddRequest {
  proxmox_node: ProxmoxNode
  iface_name: string // e.g., 'vmbr100'
  iface_type: 'bridge' | 'bond' | 'vlan'
  iface_address?: string // e.g., '10.0.100.1/24'
  iface_gateway?: string
  iface_bridge_ports?: string // e.g., 'eno1'
  iface_autostart?: boolean
  iface_comments?: string
}

export interface NodeNetwork {
  iface: string
  type: string
  active: boolean
  address?: string
  netmask?: string
  gateway?: string
  bridge_ports?: string
  comments?: string
}

// =============================================================================
// Firewall Types
// =============================================================================

export type FirewallAction = 'ACCEPT' | 'DROP' | 'REJECT'
export type FirewallDirection = 'in' | 'out'
export type FirewallProtocol = 'tcp' | 'udp' | 'icmp' | 'any'

export interface FirewallRule {
  type: FirewallDirection
  action: FirewallAction
  proto?: FirewallProtocol
  dport?: string // e.g., '22', '80,443', '1000:2000'
  sport?: string
  source?: string // IP or CIDR
  dest?: string
  iface?: string
  log?: 'nolog' | 'info' | 'warning' | 'err' | 'crit' | 'alert' | 'emerg'
  comment?: string
  enable?: boolean
  pos?: number
}

export interface FirewallRuleAddRequest {
  proxmox_node: ProxmoxNode
  vm_id: number
  vm_fw_action: FirewallAction
  vm_fw_type: FirewallDirection
  vm_fw_proto?: FirewallProtocol
  vm_fw_dport?: string
  vm_fw_sport?: string
  vm_fw_source?: string
  vm_fw_dest?: string
  vm_fw_iface?: string
  vm_fw_log?: string
  vm_fw_comment?: string
  vm_fw_enable?: boolean
  vm_fw_pos?: number
}

export interface FirewallAlias {
  name: string
  cidr: string
  comment?: string
}

// =============================================================================
// Storage Types
// =============================================================================

export interface StorageContent {
  volid: string
  format: string
  size: number
  ctime?: number
}

export interface IsoInfo {
  volid: string
  name: string
  size: number
}

export interface TemplateInfo {
  volid: string
  name: string
  size: number
}

export interface StorageDownloadIsoRequest {
  proxmox_node: ProxmoxNode
  storage: string // e.g., 'local'
  url: string
  filename: string
  checksum?: string
  checksum_algorithm?: 'md5' | 'sha1' | 'sha256' | 'sha512'
}

// =============================================================================
// Node Types (for canvas)
// =============================================================================

export type NodeType = 
  | 'group'
  | 'network-segment'
  | 'edge-firewall'
  | 'router'
  | 'switch'
  | 'vm'
  | 'lxc'

export interface BaseNodeData {
  label: string
  type: NodeType
  status: 'draft' | 'pending' | 'deploying' | 'running' | 'stopped' | 'error'
  description?: string
  tags?: string[]
}

export interface GroupNodeData extends BaseNodeData {
  type: 'group'
  name: string
  description?: string
  prefix?: string // e.g., 'lab1_' for naming resources
  resourcePool?: string // Proxmox resource pool name
  tags?: string[]
}

export interface NetworkSegmentNodeData extends BaseNodeData {
  type: 'network-segment'
  segmentType: 'wan' | 'dmz' | 'lan' | 'management' | 'custom'
  bridge: string // e.g., 'vmbr100'
  cidr: string // e.g., '10.0.100.0/24'
  gateway?: string
  vlanTag?: number
  dhcpEnabled?: boolean
  dhcpRange?: { start: string; end: string }
}

export interface RouterNodeData extends BaseNodeData {
  type: 'edge-firewall' | 'router'
  appliance: 'pfsense' | 'opnsense' | 'vyos' | 'custom'
  template?: string // Proxmox template name
  vmId?: number
  cpu?: number
  memory?: number // MB
  // Network connections are defined by EDGES to network-segment nodes
  // Each edge represents one interface (WAN, LAN, DMZ, etc.)
  // Edge data contains: IP address, interface name, VLAN tag, etc.
}

export interface VmNodeData extends BaseNodeData {
  type: 'vm'
  vmId?: number
  template?: string
  iso?: string
  cpu: number
  cores: number
  memory: number // MB
  diskSize: string // e.g., '32G'
  os?: string
  // Network connections are defined by EDGES to network-segment nodes
  // Each edge = one NIC with its own IP/config
}

export interface LxcNodeData extends BaseNodeData {
  type: 'lxc'
  vmId?: number
  template: string // OS template
  hostname: string
  cores: number
  memory: number // MB
  rootfsSize: string
  unprivileged?: boolean
  // Network connections are defined by EDGES to network-segment nodes
  // Each edge = one NIC with its own IP/config
}

export interface SwitchNodeData extends BaseNodeData {
  type: 'switch'
  portCount: number
  vlans: Array<{
    id: number
    name: string
    subnet?: string
    gateway?: string
  }>
  trunkPorts: number[]      // Ports carrying multiple VLANs
  accessPorts: Array<{
    port: number
    vlanId: number
  }>
  managementVlan?: number   // VLAN for switch management
  bridge?: string           // Optional backing Proxmox bridge
}

// =============================================================================
// Edge Types (Network Connections)
// =============================================================================

/**
 * Network connection data stored on edges between nodes.
 * Represents the actual network interface configuration.
 * 
 * IMPORTANT: This is the PRIMARY way to define network connections.
 * Each edge from a device (VM/LXC/Router/Firewall) to a network-segment
 * represents ONE NIC with its configuration.
 */
export interface NetworkConnectionData {
  /** Display name for this interface (e.g., 'WAN', 'LAN', 'eth0') */
  interfaceName?: string
  /** NIC model for the virtual interface */
  interfaceModel: 'virtio' | 'e1000' | 'rtl8139'
  /** Static IP in CIDR notation (e.g., '10.0.100.10/24') or 'dhcp' */
  ipAddress?: string
  /** Custom MAC address (optional, auto-generated if not set) */
  macAddress?: string
  /** Enable Proxmox firewall on this interface */
  firewall: boolean
  /** VLAN tag for this connection (overrides segment default) */
  vlanTag?: number
  /** Custom MTU (optional, uses bridge default if not set) */
  mtu?: number
  /** Rate limit in MB/s (optional) */
  rate?: number
  /** Whether this is the default gateway interface */
  isGateway?: boolean
}

/**
 * Extended edge data for canvas edges with network connection info
 */
export interface CanvasEdgeData {
  connection?: NetworkConnectionData
  label?: string
}

// Union type for all node data
export type CanvasNodeData = 
  | GroupNodeData
  | NetworkSegmentNodeData
  | RouterNodeData
  | SwitchNodeData
  | VmNodeData
  | LxcNodeData

// =============================================================================
// Deployment Types
// =============================================================================

export type DeploymentStepType = 
  | 'create_bridge'
  | 'create_vm'
  | 'create_lxc'
  | 'clone_template'
  | 'configure_network'
  | 'add_firewall_rule'
  | 'start_vm'
  | 'start_lxc'

export interface DeploymentStep {
  id: string
  type: DeploymentStepType
  name: string
  description: string
  nodeId: string // Canvas node ID
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  progress?: number // 0-100
  error?: string
  startedAt?: string
  completedAt?: string
  payload: unknown // API request payload - varies by step type
}

export interface DeploymentPlan {
  id: string
  projectId: string
  name: string
  steps: DeploymentStep[]
  status: 'draft' | 'validating' | 'ready' | 'deploying' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  startedAt?: string
  completedAt?: string
  currentStepIndex?: number
}

// =============================================================================
// Inventory Types (for GitHub integration)
// =============================================================================

export interface InventoryManifest {
  name: string
  version: string
  description: string
  author?: string
  repository: string
  components: InventoryComponent[]
  scenarios: InventoryScenario[]
}

export interface InventoryComponent {
  id: string
  name: string
  type: NodeType
  description: string
  tags: string[]
  path: string // Path to component JSON
  thumbnail?: string
}

export interface InventoryScenario {
  id: string
  name: string
  description: string
  tags: string[]
  path: string // Path to scenario JSON
  thumbnail?: string
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert'
}

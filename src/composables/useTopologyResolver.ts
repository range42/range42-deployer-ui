/**
 * Topology Resolver
 * 
 * Translates VueFlow canvas nodes and edges into an ordered deployment plan.
 * Handles dependency resolution to ensure resources are created in the correct order:
 * 
 * 1. Network segments (bridges) first
 * 2. Router/Firewall VMs (connect segments)
 * 3. Regular VMs/LXC containers
 * 4. Network interface configurations
 * 5. Firewall rules
 */

import { computed, ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { proxmoxCache } from '@/services/proxmox/cache'
import type {
  NodeType,
  DeploymentStep,
  DeploymentPlan,
  BaseNodeData,
  CanvasNodeData,
  CanvasEdgeData,
  NetworkSegmentNodeData,
  NetworkConnectionData,
  RouterNodeData,
  SwitchNodeData,
  VmNodeData,
  LxcNodeData,
  GroupNodeData,
  VmCreateRequest,
  LxcCreateRequest,
  NodeNetworkAddRequest,
  VmNetworkAddRequest,
} from '@/services/proxmox/types'

// =============================================================================
// Types
// =============================================================================

interface CanvasNode extends Node {
  data: CanvasNodeData
}

interface ResolverOptions {
  proxmoxNode: string
  startVmId?: number // Starting VM ID for auto-assignment
}

interface ValidationError {
  nodeId: string
  field: string
  message: string
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get node config from either direct properties or nested config object.
 * The UI stores config in node.data.config, but types expect it directly on node.data.
 * This helper handles both formats for backwards compatibility.
 */
function getNodeConfig<T>(data: CanvasNodeData): T {
  // If config object exists, merge it with top-level data
  if ('config' in data && data.config) {
    return { ...data, ...(data.config as object) } as T
  }
  return data as T
}

// =============================================================================
// Composable
// =============================================================================

export function useTopologyResolver() {
  const errors = ref<ValidationError[]>([])
  const warnings = ref<ValidationError[]>([])

  /**
   * Get deployment priority for a node type
   * Lower number = deployed first
   */
  function getNodePriority(type: NodeType): number {
    const priorities: Record<NodeType, number> = {
      'group': 0,           // Groups/containers first (organizational)
      'network-segment': 1, // Networks before VMs
      'switch': 1,          // Switches at network layer
      'edge-firewall': 2,   // Firewalls connect networks
      'router': 2,          // Routers connect networks
      'vm': 3,              // VMs after infrastructure
      'lxc': 3,             // Containers same priority as VMs
    }
    return priorities[type] ?? 99
  }

  /**
   * Validate a single node's configuration
   */
  function validateNode(node: CanvasNode): ValidationError[] {
    const nodeErrors: ValidationError[] = []
    const data = node.data

    // Common validation
    if (!data.label || data.label.trim() === '') {
      nodeErrors.push({
        nodeId: node.id,
        field: 'label',
        message: 'Node must have a name',
      })
    }

    // Type-specific validation - use getNodeConfig to handle nested config
    switch (data.type) {
      case 'network-segment': {
        const segData = getNodeConfig<NetworkSegmentNodeData>(data)
        if (!segData.bridge) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'bridge',
            message: 'Network segment must have a bridge name (e.g., vmbr100)',
          })
        }
        if (!segData.cidr) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'cidr',
            message: 'Network segment must have a CIDR (e.g., 10.0.100.0/24)',
          })
        }
        break
      }

      case 'edge-firewall':
      case 'router': {
        const routerData = getNodeConfig<RouterNodeData>(data)
        if (!routerData.appliance) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'appliance',
            message: 'Router/Firewall must specify an appliance type',
          })
        }
        // Note: Interface validation is now done at topology level
        // by checking edge connections to network-segments
        break
      }

      case 'vm': {
        // VM validation is relaxed - templates are optional in UI mode
        // Full validation happens during deployment
        break
      }

      case 'lxc': {
        const lxcData = getNodeConfig<LxcNodeData>(data)
        if (!lxcData.hostname) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'hostname',
            message: 'LXC container must have a hostname',
          })
        }
        break
      }

      case 'switch': {
        const switchData = data as SwitchNodeData
        if (!switchData.portCount || switchData.portCount < 2) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'portCount',
            message: 'Switch must have at least 2 ports',
          })
        }
        // Validate VLAN IDs are in valid range (1-4094)
        if (switchData.vlans) {
          for (const vlan of switchData.vlans) {
            if (vlan.id < 1 || vlan.id > 4094) {
              nodeErrors.push({
                nodeId: node.id,
                field: 'vlans',
                message: `Invalid VLAN ID ${vlan.id}: must be between 1-4094`,
              })
            }
          }
        }
        break
      }
    }

    return nodeErrors
  }

  /**
   * Validate CIDR notation
   */
  function isValidCidr(cidr: string): boolean {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
    if (!cidrRegex.test(cidr)) return false
    
    const [ip, prefix] = cidr.split('/')
    const prefixNum = parseInt(prefix)
    if (prefixNum < 0 || prefixNum > 32) return false
    
    const octets = ip.split('.').map(Number)
    return octets.every(o => o >= 0 && o <= 255)
  }

  /**
   * Validate bridge name format (Proxmox convention)
   */
  function isValidBridgeName(name: string): boolean {
    return /^vmbr\d+$/.test(name)
  }

  /**
   * Validate the entire topology
   */
  function validateTopology(nodes: CanvasNode[], edges: Edge[]): ValidationResult {
    const allErrors: ValidationError[] = []
    const allWarnings: ValidationError[] = []

    // Validate each node
    for (const node of nodes) {
      const nodeErrors = validateNode(node)
      allErrors.push(...nodeErrors)
    }

    // Build connection map for topology analysis
    const connectedNodeIds = new Set<string>()
    const nodeConnections = new Map<string, string[]>()
    for (const edge of edges) {
      connectedNodeIds.add(edge.source)
      connectedNodeIds.add(edge.target)
      
      if (!nodeConnections.has(edge.source)) nodeConnections.set(edge.source, [])
      if (!nodeConnections.has(edge.target)) nodeConnections.set(edge.target, [])
      nodeConnections.get(edge.source)!.push(edge.target)
      nodeConnections.get(edge.target)!.push(edge.source)
    }

    // Check for orphaned compute nodes (VMs not connected to any network)
    for (const node of nodes) {
      if (['vm', 'lxc', 'vuln-target', 'shared-service'].includes(node.data.type)) {
        if (!connectedNodeIds.has(node.id)) {
          allWarnings.push({
            nodeId: node.id,
            field: 'connection',
            message: 'Node is not connected to any network',
          })
        }
      }
    }

    // Check for network segments without connected nodes
    for (const node of nodes) {
      if (node.data.type === 'network-segment') {
        const hasConnections = edges.some(
          e => e.source === node.id || e.target === node.id
        )
        if (!hasConnections) {
          allWarnings.push({
            nodeId: node.id,
            field: 'connection',
            message: 'Network segment has no connected nodes',
          })
        }
        
        // Validate CIDR format
        const segData = node.data as NetworkSegmentNodeData
        if (segData.cidr && !isValidCidr(segData.cidr)) {
          allErrors.push({
            nodeId: node.id,
            field: 'cidr',
            message: `Invalid CIDR format: ${segData.cidr}`,
          })
        }
        
        // Validate bridge name format
        if (segData.bridge && !isValidBridgeName(segData.bridge)) {
          allWarnings.push({
            nodeId: node.id,
            field: 'bridge',
            message: `Non-standard bridge name: ${segData.bridge} (expected vmbr*)`,
          })
        }
      }
    }

    // Check for routers/firewalls with insufficient connections
    for (const node of nodes) {
      if (['router', 'edge-firewall'].includes(node.data.type)) {
        const connections = nodeConnections.get(node.id) || []
        const networkConnections = connections.filter(connId => {
          const connNode = nodes.find(n => n.id === connId)
          return connNode?.data.type === 'network-segment'
        })
        
        if (networkConnections.length < 2) {
          allWarnings.push({
            nodeId: node.id,
            field: 'connection',
            message: 'Router/Firewall should connect at least 2 network segments',
          })
        }
      }
    }

    // Check for duplicate bridge names
    const bridgeNames = new Map<string, string[]>()
    for (const node of nodes) {
      if (node.data.type === 'network-segment') {
        const segData = node.data as NetworkSegmentNodeData
        if (segData.bridge) {
          if (!bridgeNames.has(segData.bridge)) {
            bridgeNames.set(segData.bridge, [])
          }
          bridgeNames.get(segData.bridge)!.push(node.id)
        }
      }
    }
    
    const bridgeEntries = Array.from(bridgeNames.entries())
    for (const [bridge, nodeIds] of bridgeEntries) {
      if (nodeIds.length > 1) {
        for (const nodeId of nodeIds) {
          allWarnings.push({
            nodeId,
            field: 'bridge',
            message: `Bridge ${bridge} is used by multiple network segments`,
          })
        }
      }
    }

    // Check for overlapping CIDRs
    const cidrs: Array<{ nodeId: string; cidr: string }> = []
    for (const node of nodes) {
      if (node.data.type === 'network-segment') {
        const segData = node.data as NetworkSegmentNodeData
        if (segData.cidr && isValidCidr(segData.cidr)) {
          cidrs.push({ nodeId: node.id, cidr: segData.cidr })
        }
      }
    }
    
    // Simple overlap detection (same network)
    const networkAddresses = new Map<string, string[]>()
    for (const { nodeId, cidr } of cidrs) {
      const network = cidr.split('/')[0].split('.').slice(0, 3).join('.')
      if (!networkAddresses.has(network)) {
        networkAddresses.set(network, [])
      }
      networkAddresses.get(network)!.push(nodeId)
    }
    
    const networkEntries = Array.from(networkAddresses.entries())
    for (const [, nodeIds] of networkEntries) {
      if (nodeIds.length > 1) {
        for (const nodeId of nodeIds) {
          allWarnings.push({
            nodeId,
            field: 'cidr',
            message: 'Network address may overlap with another segment',
          })
        }
      }
    }

    errors.value = allErrors
    warnings.value = allWarnings

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    }
  }

  /**
   * Find which network segment a node is connected to
   */
  function findConnectedSegments(
    nodeId: string,
    nodes: CanvasNode[],
    edges: Edge[]
  ): CanvasNode[] {
    const segments: CanvasNode[] = []
    
    for (const edge of edges) {
      const connectedId = edge.source === nodeId ? edge.target : 
                          edge.target === nodeId ? edge.source : null
      
      if (connectedId) {
        const connectedNode = nodes.find(n => n.id === connectedId)
        if (connectedNode && connectedNode.data.type === 'network-segment') {
          segments.push(connectedNode)
        }
      }
    }
    
    return segments
  }

  /**
   * Find connected network segments with their edge connection data
   * Returns both the segment node and any NetworkConnectionData from the edge
   */
  function findConnectedSegmentsWithEdgeData(
    nodeId: string,
    nodes: CanvasNode[],
    edges: Edge[]
  ): Array<{ segment: CanvasNode; connectionData?: NetworkConnectionData }> {
    const connections: Array<{ segment: CanvasNode; connectionData?: NetworkConnectionData }> = []
    
    for (const edge of edges) {
      const connectedId = edge.source === nodeId ? edge.target : 
                          edge.target === nodeId ? edge.source : null
      
      if (connectedId) {
        const connectedNode = nodes.find(n => n.id === connectedId)
        if (connectedNode && connectedNode.data.type === 'network-segment') {
          // Extract connection data from edge if available
          const edgeData = edge.data as CanvasEdgeData | undefined
          connections.push({
            segment: connectedNode,
            connectionData: edgeData?.connection,
          })
        }
      }
    }
    
    return connections
  }

  /**
   * Generate a unique step ID
   */
  function generateStepId(): string {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Create deployment step for a network segment (bridge)
   */
  function createBridgeStep(
    node: CanvasNode,
    options: ResolverOptions
  ): DeploymentStep {
    const data = getNodeConfig<NetworkSegmentNodeData>(node.data)
    
    const payload: NodeNetworkAddRequest = {
      proxmox_node: options.proxmoxNode,
      iface_name: data.bridge,
      iface_type: 'bridge',
      iface_address: data.gateway ? `${data.gateway}/${data.cidr.split('/')[1]}` : undefined,
      iface_autostart: true,
      iface_comments: `${data.label} - ${data.segmentType} network`,
    }

    return {
      id: generateStepId(),
      type: 'create_bridge',
      name: `Create bridge ${data.bridge}`,
      description: `Create network segment: ${data.label} (${data.cidr})`,
      nodeId: node.id,
      status: 'pending',
      payload,
    }
  }

  /**
   * Create deployment step for a VM
   */
  function createVmStep(
    node: CanvasNode,
    vmId: number,
    options: ResolverOptions
  ): DeploymentStep {
    const data = getNodeConfig<VmNodeData>(node.data)
    
    // If template is specified, we clone; otherwise create from ISO
    if (data.template) {
      // data.template holds the source template VMID (e.g., 9221)
      // vmId is the auto-assigned ID for the NEW clone target
      const templateVmId = String(parseInt(String(data.template), 10) || 0)
      return {
        id: generateStepId(),
        type: 'clone_template',
        name: `Clone VM ${data.label}`,
        description: `Clone template ${templateVmId} → VMID ${vmId}`,
        nodeId: node.id,
        status: 'pending',
        payload: {
          proxmox_node: options.proxmoxNode,
          vm_id: templateVmId,
          vm_new_id: String(vmId),
          vm_name: (data.config?.name || data.label).replace(/\s+/g, '-').toLowerCase(),
          full_clone: true,
        },
      }
    }

    // Parse disk size: "32G" → 32, "100G" → 100
    const diskStr = String(data.diskSize || '32G')
    const diskGb = parseInt(diskStr.replace(/[gG]$/, ''), 10) || 32

    const payload: VmCreateRequest = {
      proxmox_node: options.proxmoxNode,
      vm_id: String(vmId),
      vm_name: (data.config?.name || data.label).replace(/\s+/g, '-').toLowerCase(),
      vm_cpu: 'host',
      vm_cores: data.cores || 1,
      vm_sockets: 1,
      vm_memory: data.memory || 1024,
      vm_disk_size: diskGb,
      vm_iso: data.iso,
    }

    return {
      id: generateStepId(),
      type: 'create_vm',
      name: `Create VM ${data.label}`,
      description: `Create VM with ${data.memory}MB RAM, ${data.cores} cores`,
      nodeId: node.id,
      status: 'pending',
      payload,
    }
  }

  /**
   * Create deployment step for an LXC container
   */
  function createLxcStep(
    node: CanvasNode,
    vmId: number,
    options: ResolverOptions
  ): DeploymentStep {
    const data = getNodeConfig<LxcNodeData>(node.data)

    const payload: LxcCreateRequest = {
      proxmox_node: options.proxmoxNode,
      vm_id: vmId,
      hostname: data.hostname,
      ostemplate: data.template,
      cores: data.cores || 1,
      memory: data.memory || 512,
      rootfs_size: data.rootfsSize || '8G',
      unprivileged: data.unprivileged ?? true,
    }

    return {
      id: generateStepId(),
      type: 'create_lxc',
      name: `Create LXC ${data.label}`,
      description: `Create container: ${data.hostname}`,
      nodeId: node.id,
      status: 'pending',
      payload,
    }
  }

  /**
   * Create deployment step for a router/firewall VM
   */
  function createRouterStep(
    node: CanvasNode,
    vmId: number,
    options: ResolverOptions
  ): DeploymentStep {
    const data = getNodeConfig<RouterNodeData>(node.data)

    // Routers are typically cloned from templates
    const templateVmId = String(parseInt(String(data.template), 10) || 0)
    return {
      id: generateStepId(),
      type: 'clone_template',
      name: `Deploy ${data.appliance} - ${data.label}`,
      description: `Clone template ${templateVmId || data.appliance} → VMID ${vmId}`,
      nodeId: node.id,
      status: 'pending',
      payload: {
        proxmox_node: options.proxmoxNode,
        vm_id: templateVmId,
        vm_new_id: String(vmId),
        vm_name: (data.config?.name || data.label).replace(/\s+/g, '-').toLowerCase(),
        full_clone: true,
      },
    }
  }

  /**
   * Create deployment step to configure network interface
   * Uses edge connection data if available for interface settings
   */
  function createNetworkConfigStep(
    node: CanvasNode,
    vmId: number,
    segment: CanvasNode,
    ifaceIndex: number,
    options: ResolverOptions,
    connectionData?: NetworkConnectionData
  ): DeploymentStep {
    const segmentData = getNodeConfig<NetworkSegmentNodeData>(segment.data)

    // Use connection data from edge if available, otherwise use defaults
    const payload: VmNetworkAddRequest = {
      proxmox_node: options.proxmoxNode,
      vm_id: vmId,
      iface_id: ifaceIndex,
      iface_model: connectionData?.interfaceModel || 'virtio',
      iface_bridge: segmentData.bridge,
      iface_tag: connectionData?.vlanTag || segmentData.vlanTag,
      iface_firewall: connectionData?.firewall ?? true,
      iface_mac: connectionData?.macAddress,
    }

    return {
      id: generateStepId(),
      type: 'configure_network',
      name: `Configure ${node.data.label} network`,
      description: `Connect to ${segmentData.label} (${segmentData.bridge})${connectionData?.ipAddress ? ` - ${connectionData.ipAddress}` : ''}`,
      nodeId: node.id,
      status: 'pending',
      payload,
    }
  }

  /**
   * Create deployment step to start a VM
   */
  function createStartVmStep(
    node: CanvasNode,
    vmId: number,
    options: ResolverOptions
  ): DeploymentStep {
    return {
      id: generateStepId(),
      type: 'start_vm',
      name: `Start ${node.data.label}`,
      description: `Start VM ${vmId}`,
      nodeId: node.id,
      status: 'pending',
      payload: {
        proxmox_node: options.proxmoxNode,
        vm_id: String(vmId),
      },
    }
  }

  /**
   * Resolve topology into deployment plan
   */
  function resolve(
    nodes: Node[],
    edges: Edge[],
    options: ResolverOptions
  ): DeploymentPlan {
    const canvasNodes = nodes as CanvasNode[]
    const steps: DeploymentStep[] = []
    let nextVmId = options.startVmId || 2000

    // Build set of existing VMIDs from cache to avoid conflicts
    const existingVmIds = new Set(proxmoxCache.vmCache.value.map(v => v.vmid))

    // Helper: get next available VMID that doesn't conflict
    function allocateVmId(): number {
      while (existingVmIds.has(nextVmId)) {
        nextVmId++
      }
      const id = nextVmId++
      existingVmIds.add(id) // Reserve it for this plan
      return id
    }

    // Sort nodes by deployment priority
    const sortedNodes = [...canvasNodes].sort((a, b) => {
      return getNodePriority(a.data.type) - getNodePriority(b.data.type)
    })

    // Track VM IDs assigned to each node
    const nodeVmIds = new Map<string, number>()

    // Process nodes in priority order
    for (const node of sortedNodes) {
      switch (node.data.type) {
        case 'network-segment': {
          steps.push(createBridgeStep(node, options))
          break
        }

        case 'edge-firewall':
        case 'router': {
          const vmId = allocateVmId()
          nodeVmIds.set(node.id, vmId)
          steps.push(createRouterStep(node, vmId, options))
          
          // Add network config for each connected segment (via edges)
          // This is the SAME pattern as VMs - edges define interfaces
          const connections = findConnectedSegmentsWithEdgeData(node.id, canvasNodes, edges)
          connections.forEach(({ segment, connectionData }, index) => {
            steps.push(createNetworkConfigStep(node, vmId, segment, index, options, connectionData))
          })
          break
        }

        case 'switch': {
          // Switches are logical containers for VLAN configuration
          // They can create an underlying bridge if specified
          const switchData = node.data as SwitchNodeData
          if (switchData.bridge) {
            // Create bridge for the switch if it has a backing bridge defined
            const bridgePayload: NodeNetworkAddRequest = {
              proxmox_node: options.proxmoxNode,
              iface_name: switchData.bridge,
              iface_type: 'bridge',
              iface_autostart: true,
              iface_comments: `${switchData.label} - VLAN switch (${switchData.portCount} ports)`,
            }
            steps.push({
              id: generateStepId(),
              type: 'create_bridge',
              name: `Create switch bridge ${switchData.bridge}`,
              description: `Create backing bridge for switch: ${switchData.label}`,
              nodeId: node.id,
              status: 'pending',
              payload: bridgePayload,
            })
          }
          break
        }

        case 'vm': {
          const nodeData = node.data as CanvasNodeData

          // Already deployed VMs: skip create/start, just track the existing VMID
          if (nodeData.deployed && nodeData.vmId) {
            const existingId = Number(nodeData.vmId)
            nodeVmIds.set(node.id, existingId)
            steps.push({
              id: generateStepId(),
              type: 'noop',
              name: `${nodeData.label} (already deployed)`,
              description: `VMID ${existingId} — already running on Proxmox`,
              nodeId: node.id,
              status: 'completed',
              payload: {},
            })
            break
          }

          const vmId = allocateVmId()
          nodeVmIds.set(node.id, vmId)
          steps.push(createVmStep(node, vmId, options))

          // Add network config for connected segments (with edge connection data)
          const connections = findConnectedSegmentsWithEdgeData(node.id, canvasNodes, edges)
          connections.forEach(({ segment, connectionData }, index) => {
            steps.push(createNetworkConfigStep(node, vmId, segment, index, options, connectionData))
          })
          break
        }

        case 'lxc': {
          const lxcData = node.data as CanvasNodeData
          if (lxcData.deployed && lxcData.vmId) {
            nodeVmIds.set(node.id, Number(lxcData.vmId))
            steps.push({
              id: generateStepId(),
              type: 'noop',
              name: `${lxcData.label} (already deployed)`,
              description: `VMID ${lxcData.vmId} — already running on Proxmox`,
              nodeId: node.id,
              status: 'completed',
              payload: {},
            })
            break
          }

          const vmId = allocateVmId()
          nodeVmIds.set(node.id, vmId)
          steps.push(createLxcStep(node, vmId, options))
          
          // Add network config for connected segments (with edge connection data)
          const connections = findConnectedSegmentsWithEdgeData(node.id, canvasNodes, edges)
          connections.forEach(({ segment, connectionData }, index) => {
            steps.push(createNetworkConfigStep(node, vmId, segment, index, options, connectionData))
          })
          break
        }

        case 'group': {
          // Groups are logical containers - no direct Proxmox action needed
          // Could create resource pools if specified in the future
          // const groupData = node.data as GroupNodeData
          // TODO: Implement resource pool creation when API supports it
          break
        }

        default:
          // Other node types not yet implemented
          console.warn(`Unhandled node type: ${(node.data as BaseNodeData).type}`)
      }
    }

    // Add start steps only for NEW VMs (skip already deployed ones)
    const vmIdEntries = Array.from(nodeVmIds.entries())
    for (const [nodeId, vmId] of vmIdEntries) {
      const node = canvasNodes.find(n => n.id === nodeId)
      if (node && !(node.data as CanvasNodeData).deployed) {
        steps.push(createStartVmStep(node, vmId, options))
      }
    }

    return {
      id: `plan_${Date.now()}`,
      projectId: '',
      name: 'Deployment Plan',
      steps,
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
  }

  return {
    errors: computed(() => errors.value),
    warnings: computed(() => warnings.value),
    validateTopology,
    validateNode,
    resolve,
    getNodePriority,
  }
}

export default useTopologyResolver

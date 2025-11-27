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
import type {
  NodeType,
  DeploymentStep,
  DeploymentPlan,
  BaseNodeData,
  CanvasNodeData,
  NetworkSegmentNodeData,
  RouterNodeData,
  VmNodeData,
  LxcNodeData,
  GamenetNodeData,
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
      'gamenet': 0,
      'network-segment': 1,
      'simulated-internet': 1,
      'edge-firewall': 2,
      'router': 2,
      'shared-service': 3,
      'vm': 4,
      'lxc': 4,
      'vuln-target': 4,
      'docker': 5,
      'dns': 5,
      'dhcp': 5,
      'switch': 5,
      'loadbalancer': 5,
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

    // Type-specific validation
    switch (data.type) {
      case 'network-segment': {
        const segData = data as NetworkSegmentNodeData
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
        const routerData = data as RouterNodeData
        if (!routerData.appliance) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'appliance',
            message: 'Router/Firewall must specify an appliance type',
          })
        }
        if (!routerData.interfaces || routerData.interfaces.length === 0) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'interfaces',
            message: 'Router/Firewall must have at least one interface',
          })
        }
        break
      }

      case 'vm':
      case 'vuln-target':
      case 'shared-service': {
        const vmData = data as VmNodeData
        if (!vmData.template && !vmData.iso) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'template',
            message: 'VM must have either a template or ISO specified',
          })
        }
        if (!vmData.memory || vmData.memory < 128) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'memory',
            message: 'VM must have at least 128MB memory',
          })
        }
        break
      }

      case 'lxc': {
        const lxcData = data as LxcNodeData
        if (!lxcData.template) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'template',
            message: 'LXC container must have a template specified',
          })
        }
        if (!lxcData.hostname) {
          nodeErrors.push({
            nodeId: node.id,
            field: 'hostname',
            message: 'LXC container must have a hostname',
          })
        }
        break
      }
    }

    return nodeErrors
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

    // Check for orphaned nodes (VMs not connected to any network)
    const connectedNodeIds = new Set<string>()
    for (const edge of edges) {
      connectedNodeIds.add(edge.source)
      connectedNodeIds.add(edge.target)
    }

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
    const data = node.data as NetworkSegmentNodeData
    
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
    const data = node.data as VmNodeData
    
    // If template is specified, we clone; otherwise create from ISO
    if (data.template) {
      return {
        id: generateStepId(),
        type: 'clone_template',
        name: `Clone VM ${data.label}`,
        description: `Clone from template: ${data.template}`,
        nodeId: node.id,
        status: 'pending',
        payload: {
          proxmox_node: options.proxmoxNode,
          vm_id: vmId, // Source template ID (needs lookup)
          new_vm_id: vmId,
          new_vm_name: data.label.replace(/\s+/g, '-').toLowerCase(),
          full_clone: true,
        },
      }
    }

    const payload: VmCreateRequest = {
      proxmox_node: options.proxmoxNode,
      vm_id: vmId,
      vm_name: data.label.replace(/\s+/g, '-').toLowerCase(),
      vm_cpu: 'host',
      vm_cores: data.cores || 1,
      vm_sockets: 1,
      vm_memory: data.memory || 1024,
      vm_disk_size: data.diskSize || '32G',
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
    const data = node.data as LxcNodeData

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
    const data = node.data as RouterNodeData

    // Routers are typically cloned from templates
    return {
      id: generateStepId(),
      type: 'clone_template',
      name: `Deploy ${data.appliance} - ${data.label}`,
      description: `Deploy ${data.appliance} router/firewall`,
      nodeId: node.id,
      status: 'pending',
      payload: {
        proxmox_node: options.proxmoxNode,
        template_name: data.template || `${data.appliance}-template`,
        new_vm_id: vmId,
        new_vm_name: data.label.replace(/\s+/g, '-').toLowerCase(),
        full_clone: true,
      },
    }
  }

  /**
   * Create deployment step to configure network interface
   */
  function createNetworkConfigStep(
    node: CanvasNode,
    vmId: number,
    segment: CanvasNode,
    ifaceIndex: number,
    options: ResolverOptions
  ): DeploymentStep {
    const segmentData = segment.data as NetworkSegmentNodeData

    const payload: VmNetworkAddRequest = {
      proxmox_node: options.proxmoxNode,
      vm_id: vmId,
      iface_id: ifaceIndex,
      iface_model: 'virtio',
      iface_bridge: segmentData.bridge,
      iface_firewall: true,
    }

    return {
      id: generateStepId(),
      type: 'configure_network',
      name: `Configure ${node.data.label} network`,
      description: `Connect to ${segmentData.label} (${segmentData.bridge})`,
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
        vm_id: vmId,
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
    let nextVmId = options.startVmId || 100

    // Sort nodes by deployment priority
    const sortedNodes = [...canvasNodes].sort((a, b) => {
      return getNodePriority(a.data.type) - getNodePriority(b.data.type)
    })

    // Track VM IDs assigned to each node
    const nodeVmIds = new Map<string, number>()

    // Process nodes in priority order
    for (const node of sortedNodes) {
      switch (node.data.type) {
        case 'network-segment':
        case 'simulated-internet': {
          steps.push(createBridgeStep(node, options))
          break
        }

        case 'edge-firewall':
        case 'router': {
          const vmId = nextVmId++
          nodeVmIds.set(node.id, vmId)
          steps.push(createRouterStep(node, vmId, options))
          
          // Add network config for each interface
          const routerData = node.data as RouterNodeData
          routerData.interfaces?.forEach((iface, index) => {
            const segment = canvasNodes.find(
              n => n.data.type === 'network-segment' && 
                   (n.data as NetworkSegmentNodeData).bridge === iface.bridge
            )
            if (segment) {
              steps.push(createNetworkConfigStep(node, vmId, segment, index, options))
            }
          })
          break
        }

        case 'vm':
        case 'vuln-target':
        case 'shared-service': {
          const vmId = nextVmId++
          nodeVmIds.set(node.id, vmId)
          steps.push(createVmStep(node, vmId, options))
          
          // Add network config for connected segments
          const segments = findConnectedSegments(node.id, canvasNodes, edges)
          segments.forEach((segment, index) => {
            steps.push(createNetworkConfigStep(node, vmId, segment, index, options))
          })
          break
        }

        case 'lxc': {
          const vmId = nextVmId++
          nodeVmIds.set(node.id, vmId)
          steps.push(createLxcStep(node, vmId, options))
          
          // Add network config for connected segments
          const segments = findConnectedSegments(node.id, canvasNodes, edges)
          segments.forEach((segment, index) => {
            steps.push(createNetworkConfigStep(node, vmId, segment, index, options))
          })
          break
        }

        case 'gamenet': {
          // Gamenet is a logical grouping, creates resource pool
          // TODO: Implement resource pool creation
          break
        }

        default:
          // Other node types not yet implemented
          console.warn(`Unhandled node type: ${(node.data as BaseNodeData).type}`)
      }
    }

    // Add start steps for all VMs (after all are created)
    for (const [nodeId, vmId] of nodeVmIds) {
      const node = canvasNodes.find(n => n.id === nodeId)
      if (node) {
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

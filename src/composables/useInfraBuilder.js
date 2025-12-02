import { ref } from 'vue'
import { useVueFlow, applyNodeChanges, applyEdgeChanges, addEdge } from '@vue-flow/core'

// Node types that represent compute resources
const COMPUTE_TYPES = ['vm', 'lxc', 'edge-firewall', 'router']
// Node types that represent networks
const NETWORK_TYPES = ['network-segment']

export function useInfraBuilder() {
  const { updateNodeData, getNodes } = useVueFlow()
  
  const nodes = ref([])
  const edges = ref([])
  const selectedNode = ref(null)
  const selectedEdge = ref(null)

  /**
   * Handle new connection between nodes
   * Adds default connection data for VM-to-Network connections
   */
  const handleConnect = (connection) => {
    const allNodes = getNodes.value || nodes.value
    const sourceNode = allNodes.find(n => n.id === connection.source)
    const targetNode = allNodes.find(n => n.id === connection.target)
    
    // Determine if this is a compute-to-network connection
    const isComputeToNetwork = (
      (COMPUTE_TYPES.includes(sourceNode?.type) && NETWORK_TYPES.includes(targetNode?.type)) ||
      (NETWORK_TYPES.includes(sourceNode?.type) && COMPUTE_TYPES.includes(targetNode?.type))
    )
    
    // Count existing connections to determine interface index
    const existingConnections = edges.value.filter(e => 
      e.source === connection.source || e.target === connection.source
    ).length
    
    // Create edge with connection data
    const edgeWithData = {
      ...connection,
      id: connection.id || `e-${connection.source}-${connection.target}`,
      type: isComputeToNetwork ? 'network' : 'default',  // Use custom network edge
      animated: false,
      data: isComputeToNetwork ? {
        // Nested connection object matching NetworkConnectionData
        connection: {
          interfaceName: `net${existingConnections}`,  // Auto-generate interface name
          interfaceModel: 'virtio',
          ipAddress: '',           // Static IP (CIDR notation) or empty for DHCP
          macAddress: '',          // Auto-generated if empty
          firewall: true,          // Enable Proxmox firewall on interface
          vlanTag: null,
          mtu: null,
          rate: null,
          isGateway: false,
        },
        // UI helper
        useDhcp: true,
      } : {}
    }
    
    edges.value = addEdge(edgeWithData, edges.value)
  }

  /**
   * Handle edge click to configure connection
   */
  const handleEdgeClick = (event) => {
    selectedEdge.value = event.edge
    selectedNode.value = null // Deselect node when edge is selected
  }

  /**
   * Update edge data
   * Updates are expected in format: { connection: NetworkConnectionData, ... }
   */
  const updateEdgeData = (edgeId, updates) => {
    edges.value = edges.value.map(edge => {
      if (edge.id === edgeId) {
        // Merge connection data properly
        const newData = {
          ...edge.data,
          ...updates,
          connection: {
            ...(edge.data?.connection || {}),
            ...(updates.connection || {})
          }
        }
        return { ...edge, data: newData }
      }
      return edge
    })
    
    // Update selected edge if it's the one being modified
    if (selectedEdge.value?.id === edgeId) {
      selectedEdge.value = edges.value.find(e => e.id === edgeId)
    }
  }

  /**
   * Close edge configuration
   */
  const closeEdgeConfig = () => {
    selectedEdge.value = null
  }

  const handleNodeClick = (event) => {
    selectedNode.value = event.node
  }

  const updateNodeStatus = (nodeId, updates) => {
    updateNodeData(nodeId, updates)
    
    if (selectedNode.value && selectedNode.value.id === nodeId) {
      selectedNode.value = {
        ...selectedNode.value,
        data: {
          ...selectedNode.value.data,
          ...updates
        }
      }
    }
  }

  const loadProjectData = (project) => {
    if (project && project.nodes) {
      nodes.value = project.nodes
    } else {
      nodes.value = []
    }
    
    if (project && project.edges) {
      edges.value = project.edges
    } else {
      edges.value = []
    }
    
    selectedNode.value = null
  }

  const handleNodesChange = (changes) => {
    // Apply changes to local controlled nodes state
    nodes.value = applyNodeChanges(changes, nodes.value)
  }

  const handleEdgesChange = (changes) => {
    // Apply changes to local controlled edges state
    edges.value = applyEdgeChanges(changes, edges.value)
  }

  // We handle @connect from the component template via handleConnect

  return {
    nodes,
    edges,
    selectedNode,
    selectedEdge,
    onConnect: handleConnect,
    onNodeClick: handleNodeClick,
    onEdgeClick: handleEdgeClick,
    updateNodeStatus,
    updateEdgeData,
    closeEdgeConfig,
    loadProjectData,
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange
  }
}
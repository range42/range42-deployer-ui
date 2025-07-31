<script setup>
import { ref, onMounted, markRaw } from 'vue'
import { VueFlow, useVueFlow, ConnectionMode, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/node-resizer/dist/style.css'
import InfrastructureNode from '@/components/InfrastructureNode.vue'
import NetworkNode from '@/components/NetworkNode.vue'
import { useProjectStore } from '@/composables/useProjectStore'

// Initialize VueFlow with proper state management
const {
  onConnect,
  onEdgesDelete,
  onNodesDelete,
  addNodes,
  setNodes,
  setEdges,
  findNode,
  project,
  fitView,
  onNodeDragStop
} = useVueFlow()

// Create local reactive state to avoid circular references
const nodes = ref([])
const edges = ref([])

const projectStore = useProjectStore()
const nodeIdCounter = ref(1)

// Debounce function to prevent excessive saves
const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Debounced save function
const debouncedSave = debounce((nodes, edges) => {
  projectStore.saveProject(nodes, edges)
}, 500)

// Enhanced node types with better categorization
const nodeTypes = {
  // VM Types
  'vm-windows': markRaw(InfrastructureNode),
  'vm-linux': markRaw(InfrastructureNode),
  'vm-freebsd': markRaw(InfrastructureNode),
  'vm-macos': markRaw(InfrastructureNode),

  // Network Types - Use special NetworkNode for resizable containers
  'network': markRaw(NetworkNode),
  'subnet': markRaw(NetworkNode),

  // Infrastructure Types
  'router': markRaw(InfrastructureNode),
  'firewall': markRaw(InfrastructureNode),
  'load-balancer': markRaw(InfrastructureNode),

  // Application Types
  'docker': markRaw(InfrastructureNode),
  'nginx': markRaw(InfrastructureNode),
  'apache': markRaw(InfrastructureNode),
  'ftp': markRaw(InfrastructureNode),
  'database': markRaw(InfrastructureNode),
  'mail': markRaw(InfrastructureNode),
  'dns': markRaw(InfrastructureNode),
  'vpn': markRaw(InfrastructureNode)
}

// Enhanced node templates with specific configurations
const nodeTemplates = {
  // VM Templates
  'vm-windows': {
    type: 'vm-windows',
    label: 'Windows VM',
    status: 'gray',
    config: {
      name: '',
      cpu: 2,
      memory: '4GB',
      disk: '50GB',
      os: 'Windows Server 2022',
      network: ''
    }
  },
  'vm-linux': {
    type: 'vm-linux',
    label: 'Linux VM',
    status: 'gray',
    config: {
      name: '',
      cpu: 2,
      memory: '4GB',
      disk: '20GB',
      os: 'Ubuntu 22.04',
      network: ''
    }
  },
  'vm-freebsd': {
    type: 'vm-freebsd',
    label: 'FreeBSD VM',
    status: 'gray',
    config: {
      name: '',
      cpu: 2,
      memory: '4GB',
      disk: '20GB',
      os: 'FreeBSD 13',
      network: ''
    }
  },
  'vm-macos': {
    type: 'vm-macos',
    label: 'macOS VM',
    status: 'gray',
    config: {
      name: '',
      cpu: 2,
      memory: '4GB',
      disk: '50GB',
      os: 'macOS Monterey',
      network: ''
    }
  },

  // Network Templates
  'network': {
    type: 'network',
    label: 'Network',
    status: 'gray',
    draggable: true,
    selectable: true,
    config: {
      name: '',
      cidr: '192.168.1.0/24',
      gateway: '192.168.1.1',
      dns: ['8.8.8.8', '8.8.4.4']
    },
    style: {
      width: 600,
      height: 400,
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      border: '2px dashed rgba(59, 130, 246, 0.5)',
      borderRadius: '8px'
    }
  },
  'subnet': {
    type: 'subnet',
    label: 'Subnet',
    status: 'gray',
    draggable: true,
    selectable: true,
    config: {
      name: '',
      cidr: '192.168.1.0/26',
      gateway: '192.168.1.1',
      parent_network: ''
    },
    style: {
      width: 400,
      height: 300,
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      border: '2px dashed rgba(34, 197, 94, 0.5)',
      borderRadius: '8px'
    }
  },
  'router': {
    type: 'router',
    label: 'Router',
    status: 'gray',
    config: {
      name: '',
      model: 'Cisco',
      interfaces: [],
      routing_protocol: 'OSPF'
    }
  },
  'firewall': {
    type: 'firewall',
    label: 'Firewall',
    status: 'gray',
    config: {
      name: '',
      type: 'pfSense',
      rules: [],
      interfaces: []
    }
  },
  'load-balancer': {
    type: 'load-balancer',
    label: 'Load Balancer',
    status: 'gray',
    config: {
      name: '',
      algorithm: 'round-robin',
      health_check: true,
      backends: []
    }
  },

  // Application Templates
  'docker': {
    type: 'docker',
    label: 'Docker Container',
    status: 'gray',
    config: {
      name: '',
      image: 'nginx:latest',
      ports: [],
      environment: [],
      volumes: []
    }
  },
  'nginx': {
    type: 'nginx',
    label: 'Nginx Server',
    status: 'gray',
    config: {
      name: '',
      version: '1.24',
      ssl: false,
      domains: [],
      upstream_servers: []
    }
  },
  'apache': {
    type: 'apache',
    label: 'Apache Server',
    status: 'gray',
    config: {
      name: '',
      version: '2.4',
      ssl: false,
      virtual_hosts: []
    }
  },
  'ftp': {
    type: 'ftp',
    label: 'FTP Server',
    status: 'gray',
    config: {
      name: '',
      type: 'vsftpd',
      port: 21,
      users: []
    }
  },
  'database': {
    type: 'database',
    label: 'Database Server',
    status: 'gray',
    config: {
      name: '',
      type: 'PostgreSQL',
      version: '15',
      port: 5432,
      databases: []
    }
  },
  'mail': {
    type: 'mail',
    label: 'Mail Server',
    status: 'gray',
    config: {
      name: '',
      type: 'Postfix',
      domains: [],
      ssl: true
    }
  },
  'dns': {
    type: 'dns',
    label: 'DNS Server',
    status: 'gray',
    config: {
      name: '',
      type: 'BIND',
      zones: [],
      forwarders: []
    }
  },
  'vpn': {
    type: 'vpn',
    label: 'VPN Server',
    status: 'gray',
    config: {
      name: '',
      type: 'OpenVPN',
      port: 1194,
      clients: []
    }
  }
}

// Connection rules defining what can connect to what
const connectionRules = {
  // VMs can connect to network infrastructure and each other
  'vm-windows': {
    canConnectTo: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos', 'apache', 'ftp', 'database', 'mail', 'dns', 'vpn']
  },
  'vm-linux': {
    canConnectTo: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos', 'docker', 'nginx', 'apache', 'ftp', 'database', 'mail', 'dns', 'vpn']
  },
  'vm-freebsd': {
    canConnectTo: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos', 'nginx', 'apache', 'ftp', 'database', 'mail', 'dns', 'vpn']
  },
  'vm-macos': {
    canConnectTo: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['router', 'firewall', 'load-balancer', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos', 'apache', 'ftp', 'database', 'mail', 'dns']
  },

  // Network infrastructure
  'network': {
    canConnectTo: ['router', 'firewall'],
    canReceiveFrom: []
  },
  'subnet': {
    canConnectTo: ['router', 'firewall'],
    canReceiveFrom: ['network']
  },
  'router': {
    canConnectTo: ['network', 'subnet', 'router', 'firewall', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['network', 'subnet', 'router', 'firewall', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos']
  },
  'firewall': {
    canConnectTo: ['network', 'subnet', 'router', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['network', 'subnet', 'router', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos']
  },
  'load-balancer': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: ['router', 'firewall']
  },

  // Applications - Linux only apps can't connect to Windows/macOS
  'docker': {
    canConnectTo: ['vm-linux', 'vm-freebsd'],
    canReceiveFrom: []
  },
  'nginx': {
    canConnectTo: ['vm-linux', 'vm-freebsd'],
    canReceiveFrom: []
  },
  'apache': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: []
  },
  'ftp': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: []
  },
  'database': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: []
  },
  'mail': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: []
  },
  'dns': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos'],
    canReceiveFrom: []
  },
  'vpn': {
    canConnectTo: ['vm-windows', 'vm-linux', 'vm-freebsd'],
    canReceiveFrom: []
  }
}

// Nested nodes functionality with network hierarchy
const nestedNodeConfig = {
  // Define which node types can be parents
  parentTypes: ['network', 'subnet'],

  // Define which node types can be children of specific parents
  childTypes: {
    'network': ['subnet', 'vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos', 'router', 'firewall', 'load-balancer'],
    'subnet': ['vm-windows', 'vm-linux', 'vm-freebsd', 'vm-macos', 'router', 'firewall', 'load-balancer']
  },

  // Define minimum sizes for parent nodes
  minSizes: {
    'network': { width: 400, height: 300 },
    'subnet': { width: 300, height: 200 }
  }
}

// Function to check if a node can be a parent
const canBeParent = (nodeType) => {
  return nestedNodeConfig.parentTypes.includes(nodeType)
}

// Function to check if a node can be a child of a specific parent
const canBeChildOf = (childType, parentType) => {
  const allowedChildren = nestedNodeConfig.childTypes[parentType] || []
  return allowedChildren.includes(childType)
}

// Enhanced drop handler with nested nodes support
const handleDrop = async (event) => {
  event.preventDefault()
  event.stopPropagation()

  try {
    const data = JSON.parse(event.dataTransfer.getData('application/vueflow'))
    const nodeType = data.type

    if (nodeTemplates[nodeType]) {
      const template = nodeTemplates[nodeType]

      // Get the actual canvas position
      const { left, top } = project({
        x: event.clientX,
        y: event.clientY,
      })

      const newNode = {
        id: `node-${nodeIdCounter.value++}`,
        type: nodeType,
        position: { x: left - 125, y: top - 50 }, // Center the node on cursor
        data: {
          ...template,
          id: `node-${nodeIdCounter.value - 1}`
        },
        draggable: true,
        selectable: true
      }

      // Set size and style for different node types
      if (canBeParent(nodeType)) {
        const defaultSize = template.style
        newNode.style = defaultSize
        newNode.width = defaultSize.width
        newNode.height = defaultSize.height
      }

      // Add source and target handles based on connection rules
      const rules = connectionRules[nodeType]
      if (rules) {
        newNode.sourcePosition = Position.Right
        newNode.targetPosition = Position.Left
      }

      // Update local state first
      nodes.value = [...nodes.value, newNode]

      // Then update VueFlow state
      addNodes([newNode])

      // Check if dropped inside a parent node
      setTimeout(() => {
        updateNestedRelationships()
        debouncedSave(nodes.value, edges.value)
      }, 100)
    }
  } catch (error) {
    console.error('Error handling drop:', error)
  }
}

const handleDragOver = (event) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'

  // Add visual feedback for drop zones
  const networkNodes = document.querySelectorAll('.network-node')
  networkNodes.forEach(node => {
    node.classList.add('drag-over')
  })
}

const handleDragLeave = () => {
  // Remove visual feedback when leaving drop zones
  const networkNodes = document.querySelectorAll('.network-node')
  networkNodes.forEach(node => {
    node.classList.remove('drag-over')
  })
}

// Function to check if a node is inside another node
const isNodeInside = (child, parent) => {
  const childBounds = {
    left: child.position.x,
    top: child.position.y,
    right: child.position.x + (child.width || 250),
    bottom: child.position.y + (child.height || 100)
  }

  const parentBounds = {
    left: parent.position.x,
    top: parent.position.y,
    right: parent.position.x + (parent.width || 250),
    bottom: parent.position.y + (parent.height || 100)
  }

  return (
    childBounds.left >= parentBounds.left &&
    childBounds.top >= parentBounds.top &&
    childBounds.right <= parentBounds.right &&
    childBounds.bottom <= parentBounds.bottom
  )
}

// Function to update nested node relationships
const updateNestedRelationships = () => {
  const allNodes = nodes.value
  const updatedNodes = allNodes.map(node => {
    // Skip parent nodes
    if (canBeParent(node.type)) {
      return node
    }

    // Find potential parent nodes
    let bestParent = null
    let smallestArea = Infinity

    for (const potentialParent of allNodes) {
      if (
        canBeParent(potentialParent.type) &&
        potentialParent.id !== node.id &&
        canBeChildOf(node.type, potentialParent.type) &&
        isNodeInside(node, potentialParent)
      ) {
        // Calculate area to find the smallest containing parent
        const area = (potentialParent.width || 250) * (potentialParent.height || 100)
        if (area < smallestArea) {
          smallestArea = area
          bestParent = potentialParent
        }
      }
    }

    if (bestParent) {
      return {
        ...node,
        parentNode: bestParent.id,
        extent: 'parent' // This makes the node constrained to parent bounds
      }
    } else {
      // Remove parent relationship if no valid parent found
      const nodeWithoutParent = { ...node }
      delete nodeWithoutParent.parentNode
      delete nodeWithoutParent.extent
      return nodeWithoutParent
    }
  })

  nodes.value = updatedNodes
  setNodes(updatedNodes)
}

// Connection validation
const isValidConnection = (connection) => {
  const sourceNode = findNode(connection.source)
  const targetNode = findNode(connection.target)

  if (!sourceNode || !targetNode) return false

  const sourceType = sourceNode.type
  const targetType = targetNode.type

  // Check if source can connect to target
  const sourceRules = connectionRules[sourceType]
  if (!sourceRules) return false

  return sourceRules.canConnectTo.includes(targetType)
}

const handleConnect = (params) => {
  if (isValidConnection(params)) {
    const newEdge = {
      id: `edge-${Date.now()}`,
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      type: 'smoothstep',
      animated: true,
      style: {
        stroke: 'hsl(var(--p))',
        strokeWidth: 2
      }
    }

    edges.value = [...edges.value, newEdge]
    onConnect(newEdge)
    debouncedSave(nodes.value, edges.value)
  } else {
    // Show error message
    console.warn('Invalid connection attempt')
  }
}

// Handle node drag
const handleNodeDragStop = () => {
  updateNestedRelationships()
  debouncedSave(nodes.value, edges.value)
}

// Handle node resize
const handleNodeResize = (nodeId, dimensions) => {
  console.log('Node resize:', nodeId, dimensions)
  const node = nodes.value.find(n => n.id === nodeId)
  if (node) {
    node.width = dimensions.width
    node.height = dimensions.height

    // Update nested relationships after resize
    updateNestedRelationships()
    debouncedSave(nodes.value, edges.value)
  }
}

// Handle node edit
const handleNodeEdit = (nodeId, nodeData) => {
  console.log('Edit node:', nodeId, nodeData)
  // TODO: Implement edit modal or form
  // For now, just log the edit request
  alert(`Edit functionality for ${nodeData.label} (${nodeId}) will be implemented soon!`)
}

// Handle node and edge deletions
const handleNodesDelete = (nodesToDelete) => {
  const nodeIdsToDelete = nodesToDelete.map(node => node.id)

  // Remove nodes and their children
  const nodesToRemove = new Set(nodeIdsToDelete)

  // Find all children of deleted nodes
  nodes.value.forEach(node => {
    if (node.parentNode && nodesToRemove.has(node.parentNode)) {
      nodesToRemove.add(node.id)
    }
  })

  nodes.value = nodes.value.filter(node => !nodesToRemove.has(node.id))
  edges.value = edges.value.filter(edge =>
    !nodesToRemove.has(edge.source) && !nodesToRemove.has(edge.target)
  )

  onNodesDelete(nodesToDelete)
  debouncedSave(nodes.value, edges.value)
}

const handleEdgesDelete = (edgesToDelete) => {
  const edgeIdsToDelete = edgesToDelete.map(edge => edge.id)
  edges.value = edges.value.filter(edge => !edgeIdsToDelete.includes(edge.id))

  onEdgesDelete(edgesToDelete)
  debouncedSave(nodes.value, edges.value)
}

// Project management functions
const saveProject = () => {
  return projectStore.saveProject(nodes.value, edges.value)
}

const loadProject = async () => {
  try {
    const { nodes: loadedNodes, edges: loadedEdges } = projectStore.loadProject()

    nodes.value = loadedNodes
    edges.value = loadedEdges

    setNodes(loadedNodes)
    setEdges(loadedEdges)

    // Fit view after loading
    setTimeout(() => {
      fitView({ padding: 0.1 })
    }, 100)

    console.log('Project loaded successfully')
  } catch (error) {
    console.error('Error loading project:', error)
  }
}

const exportProject = () => {
  const projectData = projectStore.exportProjectData(nodes.value, edges.value)

  const dataBlob = new Blob([projectData], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'infrastructure-project.json'
  link.click()
  URL.revokeObjectURL(url)
}

const clearCanvas = async () => {
  nodes.value = []
  edges.value = []

  setNodes([])
  setEdges([])

  debouncedSave([], [])
}

// Generate deployment JSON
const generateDeploymentJSON = () => {
  const deployment = {
    timestamp: new Date().toISOString(),
    infrastructure: {
      networks: [],
      nodes: [],
      connections: []
    }
  }

  // Process networks and subnets first
  nodes.value.forEach(node => {
    if (node.type === 'network' || node.type === 'subnet') {
      deployment.infrastructure.networks.push({
        id: node.id,
        type: node.type,
        config: node.data.config,
        children: nodes.value
          .filter(n => n.parentNode === node.id)
          .map(n => n.id)
      })
    }
  })

  // Process other nodes
  nodes.value.forEach(node => {
    if (node.type !== 'network' && node.type !== 'subnet') {
      deployment.infrastructure.nodes.push({
        id: node.id,
        type: node.type,
        config: node.data.config,
        parentNetwork: node.parentNode || null,
        status: node.data.status
      })
    }
  })

  // Process connections
  edges.value.forEach(edge => {
    const sourceNode = nodes.value.find(n => n.id === edge.source)
    const targetNode = nodes.value.find(n => n.id === edge.target)

    deployment.infrastructure.connections.push({
      id: edge.id,
      source: {
        id: edge.source,
        type: sourceNode?.type
      },
      target: {
        id: edge.target,
        type: targetNode?.type
      }
    })
  })

  return deployment
}

// Export deployment JSON
const exportDeployment = () => {
  const deploymentData = JSON.stringify(generateDeploymentJSON(), null, 2)

  const dataBlob = new Blob([deploymentData], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = `deployment-${Date.now()}.json`
  link.click()
  URL.revokeObjectURL(url)
}

// Watch for node position changes
onNodeDragStop(handleNodeDragStop)

// Initialize on mount
onMounted(async () => {
  await loadProject()
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Enhanced Toolbar -->
    <div class="navbar bg-base-100 border-b border-base-300 shadow-sm">
      <div class="flex-1">
        <h2 class="text-lg font-semibold text-base-content">Infrastructure Designer</h2>
        <p class="text-xs text-base-content/70">Drag components from the sidebar to build your infrastructure</p>
        <div class="flex items-center gap-4 mt-1">
          <span class="text-xs text-base-content/60">🌐 Networks are resizable containers</span>
          <span class="text-xs text-base-content/60">🔗 Connect nodes based on compatibility</span>
          <span class="text-xs text-base-content/60">📦 Drop nodes inside networks</span>
        </div>
      </div>
      <div class="flex-none gap-2">
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-outline btn-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
            </svg>
            Actions
          </div>
          <ul tabindex="0" class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52">
            <li><a @click="saveProject">💾 Save Project</a></li>
            <li><a @click="exportProject">📤 Export Project</a></li>
            <li><a @click="exportDeployment">🚀 Export Deployment JSON</a></li>
            <li class="divider"></li>
            <li><a @click="clearCanvas">🗑️ Clear Canvas</a></li>
          </ul>
        </div>
        <button @click="exportDeployment" class="btn btn-primary btn-sm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V2"></path>
          </svg>
          Deploy
        </button>
      </div>
    </div>

    <!-- VueFlow Canvas with Drop Zone -->
    <div
      class="flex-1 relative bg-gradient-to-br from-base-200 to-base-300"
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
    >
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 1 }"
        :min-zoom="0.2"
        :max-zoom="4"
        :connection-mode="ConnectionMode.Strict"
        :connection-line-type="'smoothstep'"
        :connection-line-style="{ stroke: 'hsl(var(--p))', strokeWidth: 2 }"
        :delete-key-code="['Delete', 'Backspace']"
        :nodes-draggable="true"
        :nodes-connectable="true"
        :elements-selectable="true"
        @connect="handleConnect"
        @edges-delete="handleEdgesDelete"
        @nodes-delete="handleNodesDelete"
        @node-drag-stop="handleNodeDragStop"
        @node-resize="handleNodeResize"
        @node-edit="handleNodeEdit"
        class="bg-transparent"
        fit-view-on-init
      >
        <Background
          :pattern-color="'hsl(var(--bc) / 0.1)'"
          :gap="20"
          :size="1"
        />
        <MiniMap
          :node-color="(node) => {
            if (node.type === 'network') return 'rgba(59, 130, 246, 0.5)'
            if (node.type === 'subnet') return 'rgba(34, 197, 94, 0.5)'
            return 'hsl(var(--p))'
          }"
          :mask-color="'hsl(var(--b1) / 0.8)'"
        />
        <Controls
          class="bg-base-100 shadow-lg border border-base-300"
        />
      </VueFlow>

      <!-- Drop Zone Overlay -->
      <div
        v-if="!nodes.length"
        class="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div class="text-center">
          <div class="text-6xl mb-4 opacity-20">🏗️</div>
          <h3 class="text-xl font-semibold text-base-content/70 mb-2">Start Building</h3>
          <p class="text-base-content/50">Drag components from the sidebar to begin</p>
          <div class="mt-4 text-sm text-base-content/40">
            <p>• Networks and Subnets are resizable containers</p>
            <p>• Drop VMs and services inside networks</p>
            <p>• Connect nodes based on compatibility rules</p>
          </div>
        </div>
      </div>

      <!-- Connection Error Toast -->
      <div class="toast toast-top toast-end">
        <div class="alert alert-error" v-if="false">
          <span>Invalid connection! Check compatibility rules.</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vue-flow {
  background: transparent;
}

:deep(.vue-flow__node) {
  transition: all 0.2s ease-in-out;
}

:deep(.vue-flow__node:hover) {
  transform: scale(1.02);
  z-index: 10;
}

:deep(.vue-flow__edge) {
  transition: all 0.2s ease-in-out;
}

:deep(.vue-flow__edge:hover) {
  stroke-width: 3 !important;
}

:deep(.vue-flow__edge-path) {
  stroke-linecap: round;
}

:deep(.vue-flow__connection-path) {
  stroke-dasharray: 5 5;
  animation: dash 0.5s linear infinite;
}

@keyframes dash {
  to {
    stroke-dashoffset: -10;
  }
}

/* Style for nested nodes */
:deep(.vue-flow__node--parent) {
  background: transparent !important;
}
</style>

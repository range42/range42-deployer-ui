import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

const state = {
  draggedType: ref(null),
  isDragOver: ref(false),
  isDragging: ref(false),
}

let id = 0
function getId() {
  return `dndnode_${id++}`
}

export function useDragAndDrop() {
  const { draggedType, isDragOver, isDragging } = state
  const { 
    addNodes, 
    screenToFlowCoordinate, 
    onNodesInitialized, 
    updateNode,
    getNodes,
    updateNodeData
  } = useVueFlow()

  const onDragStart = (event, type) => {
    if (event.dataTransfer) {
      event.dataTransfer.setData('application/vueflow', type)
      event.dataTransfer.effectAllowed = 'move'
    }
    draggedType.value = type
    isDragging.value = true
    document.addEventListener('drop', onDragEnd)
    document.addEventListener('dragend', onDragEnd)
  }

  const onDragOver = (event) => {
    event.preventDefault()
    if (draggedType.value) {
      isDragOver.value = true
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    }
  }

  const onDragLeave = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      isDragOver.value = false
    }
  }

  const onDragEnd = () => {
    isDragging.value = false
    isDragOver.value = false
    draggedType.value = null
    document.removeEventListener('drop', onDragEnd)
    document.removeEventListener('dragend', onDragEnd)
  }

  // Container node types that can hold child nodes
  const containerTypes = ['network-segment', 'group']

  // Find potential parent node at drop position
  const findParentNodeAtPosition = (position) => {
    const nodes = getNodes.value
    
    // Sort by z-index/layer - prefer smaller containers over larger ones
    const containerNodes = nodes
      .filter(n => containerTypes.includes(n.type) && n.computedPosition && n.dimensions)
      .sort((a, b) => (a.dimensions.width * a.dimensions.height) - (b.dimensions.width * b.dimensions.height))
    
    for (const node of containerNodes) {
      const nodeRect = {
        x: node.computedPosition.x,
        y: node.computedPosition.y,
        width: node.dimensions.width,
        height: node.dimensions.height
      }
      
      if (position.x >= nodeRect.x && 
          position.x <= nodeRect.x + nodeRect.width &&
          position.y >= nodeRect.y && 
          position.y <= nodeRect.y + nodeRect.height) {
        return {
          parentNode: node,
          relativePosition: {
            x: position.x - nodeRect.x,
            y: position.y - nodeRect.y
          }
        }
      }
    }
    
    return null
  }

  const onDrop = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!draggedType.value) return

    const position = screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    })

    const parentInfo = findParentNodeAtPosition(position)
    const nodeConfig = getNodeConfig(draggedType.value)
    const nodeId = getId()

    const baseNode = {
      id: nodeId,
      type: draggedType.value,
      data: {
        type: draggedType.value,
        label: nodeConfig.label,
        status: 'gray',
        config: nodeConfig.defaultConfig,
      },
    }

    let newNode
    const isContainerType = containerTypes.includes(draggedType.value)
    
    if (parentInfo && !isContainerType) {
      newNode = {
        ...baseNode,
        position: parentInfo.relativePosition,
        parentNode: parentInfo.parentNode.id,
        extent: 'parent',
        expandParent: true,
      }

      updateNodeData(parentInfo.parentNode.id, { hasChildren: true })
    } else {
      newNode = {
        ...baseNode,
        position,
      }

      // Set default size for container types
      if (isContainerType) {
        newNode.style = draggedType.value === 'group' 
          ? { width: '450px', height: '350px' }
          : { width: '300px', height: '200px' }
      }
    }

    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => {
        if (!node.parentNode) {
          return {
            position: {
              x: node.position.x - (node.dimensions?.width || 150) / 2,
              y: node.position.y - (node.dimensions?.height || 100) / 2,
            },
          }
        }
        return node
      })
      off()
    })

    addNodes([newNode])
    
    isDragOver.value = false
    isDragging.value = false
    draggedType.value = null
  }

  const getNodeConfig = (type) => {
    const configs = {
      vm: {
        label: 'Virtual Machine',
        defaultConfig: {
          name: '',
          description: '',
          // These are used by topology resolver for deployment planning
          // Backend API routes for custom VM creation are planned
          vmId: null,              // Auto-assigned during deployment
          ipAddress: '',           // Static IP for the VM
        },
      },
      'network-segment': {
        label: 'Network Segment',
        defaultConfig: {
          name: '',
          description: '',
          // Proxmox bridge - must exist on the target node
          bridge: 'vmbr0',
          vlan: null,             // Optional VLAN tag (1-4094)
          // Network addressing (for documentation/planning)
          cidr: '192.168.1.0/24',
          gateway: '192.168.1.1',
        },
      },
      router: {
        label: 'Router',
        defaultConfig: {
          name: '',
          description: '',
          applianceType: 'vyos',  // vyos, opnsense, etc.
        },
      },
      // Generic container/group for organizing infrastructure
      group: {
        label: 'Group',
        defaultConfig: {
          name: '',
          description: '',
          prefix: '',
          resourcePool: '',
          tags: [],
        },
      },
      // LXC container
      lxc: {
        label: 'LXC Container',
        defaultConfig: {
          name: '',
          description: '',
          hostname: '',
          ipAddress: '',           // Static IP for the container
        },
      },
      // Edge firewall (pfSense, OPNsense, etc.)
      'edge-firewall': {
        label: 'Edge Firewall',
        defaultConfig: {
          name: '',
          description: '',
          applianceType: 'pfsense',  // pfsense, opnsense
        },
      },
    }
    return configs[type] || configs.vm
  }

  return {
    draggedType,
    isDragOver,
    isDragging,
    onDragStart,
    onDragLeave,
    onDragOver,
    onDrop,
  }
}
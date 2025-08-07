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

  // Find potential parent node at drop position
  const findParentNodeAtPosition = (position) => {
    const nodes = getNodes.value
    
    // Look for network nodes that could contain the dropped node
    for (const node of nodes) {
      if (node.type === 'network' && node.computedPosition && node.dimensions) {
        const nodeRect = {
          x: node.computedPosition.x,
          y: node.computedPosition.y,
          width: node.dimensions.width,
          height: node.dimensions.height
        }
        
        // Check if drop position is within the network node bounds
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

    // Check if dropping inside a network node
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

    // Configure node based on whether it's nested or standalone
    let newNode
    if (parentInfo && draggedType.value !== 'network') {
      // Create nested node
      newNode = {
        ...baseNode,
        position: parentInfo.relativePosition,
        parentNode: parentInfo.parentNode.id,
        extent: 'parent', // Constrain movement to parent bounds
        expandParent: true, // Auto-expand parent if needed
      }

      // Update parent to indicate it has children
      updateNodeData(parentInfo.parentNode.id, { hasChildren: true })
    } else {
      // Create standalone node
      newNode = {
        ...baseNode,
        position,
      }

      // If it's a network node, set initial size
      if (draggedType.value === 'network') {
        newNode.style = {
          width: '300px',
          height: '200px',
        }
      }
    }

    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => {
        if (!node.parentNode) {
          // Only center standalone nodes
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
          cpu: null,
          memory: '',
          disk: '',
          os: 'Ubuntu 22.04',
        },
      },
      network: {
        label: 'Network Zone',
        defaultConfig: {
          name: '',
          cidr: '192.168.1.0/24',
          gateway: '192.168.1.1',
          dhcp: true,
        },
      },
      docker: {
        label: 'Docker Container',
        defaultConfig: {
          name: '',
          image: 'nginx:latest',
          ports: '80:80',
          env: '',
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
    onDragOver,
    onDragLeave,
    onDrop,
  }
}
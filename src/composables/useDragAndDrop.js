import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { findNearestDockerHost } from './useInfraBuilder'

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
    vueFlowRef,
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

  // Dragging and button activation share exactly the same node defaults,
  // nesting rules and Docker host selection.
  function addNode(type, position, onPlaced) {
    const parentInfo = findParentNodeAtPosition(position)
    const nodeConfig = getNodeConfig(type)
    let nodeId = getId()
    while (getNodes.value.some(node => node.id === nodeId)) nodeId = getId()

    const baseNode = {
      id: nodeId,
      type: type,
      data: {
        type: type,
        label: nodeConfig.label,
        status: 'gray',
        config: nodeConfig.defaultConfig,
      },
    }

    // Docker node: auto-assign the nearest vm|lxc as host_ref on drop.
    // If none exists, leave host_ref empty — the Problems panel will surface it
    // and the GroupNode/DockerNode red dot makes the issue visible.
    if (type === 'docker') {
      const nearestHost = findNearestDockerHost(getNodes.value || [], position)
      if (nearestHost) {
        baseNode.data.host_ref = nearestHost.id
      }
    }

    let newNode
    const isContainerType = containerTypes.includes(type)
    
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
        newNode.style = type === 'group'
          ? { width: '450px', height: '350px' }
          : { width: '300px', height: '200px' }
      }
    }

    if (type === 'note') newNode.style = { width: '320px', height: '200px' }

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
      onPlaced?.()
    })

    addNodes([newNode])
    
    return nodeId
  }

  function addComponent(type, onPlaced) {
    const bounds = vueFlowRef.value?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) return null
    return addNode(type, screenToFlowCoordinate({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }), onPlaced)
  }

  const onDrop = (event, onPlaced) => {
    event.preventDefault()
    event.stopPropagation()
    if (!draggedType.value) return
    const nodeId = addNode(draggedType.value, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }), onPlaced)
    onDragEnd()
    return nodeId
  }

  const getNodeConfig = (type) => {
    const configs = {
      note: {
        label: 'Note',
        defaultConfig: { name: '', text: '', color: 'yellow' },
      },
      vm: {
        label: 'Virtual Machine',
        defaultConfig: {
          name: '',
          description: '',
          template: '',            // Proxmox template VMID to clone from
          cores: 2,                // CPU cores
          memory: 2048,            // RAM in MB
          diskSize: '32G',         // Disk size
          vmId: null,              // Auto-assigned during deployment
          ipAddress: '',           // Static IP for the VM
        },
      },
      'network-segment': {
        label: 'Network Segment',
        defaultConfig: {
          name: '',
          description: '',
          segmentType: 'lan',     // wan, dmz, lan, management, custom
          // Proxmox bridge - must exist on the target node
          bridge: 'vmbr142',
          vlan: null,             // Optional VLAN tag (1-4094)
          // Network addressing (for documentation/planning)
          cidr: '192.168.42.0/24',
          gateway: '192.168.42.1',
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
      // Docker container (must tether to a vm|lxc host via host_ref)
      docker: {
        label: 'Docker Container',
        defaultConfig: {
          name: '',
          description: '',
          image: '',
          ports: [],
          env: {},
          host_ref: '',      // authoritative host id — mirrored to data.host_ref
        },
      },
      // VLAN-aware switch for network segmentation
      switch: {
        label: 'Switch',
        defaultConfig: {
          name: '',
          description: '',
          portCount: 24,
          vlans: [],                  // Array of {id, name, subnet?, gateway?}
          trunkPorts: [],             // Ports carrying multiple VLANs
          accessPorts: [],            // Array of {port, vlanId}
          managementVlan: null,       // VLAN for switch management
          bridge: 'vmbr0',            // Backing Proxmox bridge
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
    addComponent,
  }
}

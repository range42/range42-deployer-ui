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
    
    for (const node of nodes) {
      if (node.type === 'network-segment' && node.computedPosition && node.dimensions) {
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
    if (parentInfo && draggedType.value !== 'network-segment') {
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

      if (draggedType.value === 'network-segment') {
        newNode.style = {
          width: '300px',
          height: '200px',
        }
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
          cpu: null,
          memory: '',
          disk: '',
          os: 'Ubuntu 22.04',
        },
      },
      'network-segment': {
        label: 'Network Segment',
        defaultConfig: {
          name: '',
          cidr: '192.168.1.0/24',
          gateway: '192.168.1.1',
          segmentType: 'production',
          securityLevel: 'medium',
          vlan: null,
          dns: '',
          dhcp: true,
        },
      },
      router: {
        label: 'Router',
        defaultConfig: {
          name: '',
          routingProtocol: 'OSPF',
          routerId: '1.1.1.1',
          interfaces: [
            { name: 'eth0', ip: '', subnet: '', description: 'WAN Interface' },
            { name: 'eth1', ip: '', subnet: '', description: 'LAN Interface' }
          ],
        },
      },
      switch: {
        label: 'Network Switch',
        defaultConfig: {
          name: '',
          portCount: 24,
          vlanSupport: true,
          vlans: [
            { id: 1, name: 'default', description: 'Default VLAN' }
          ],
          spanningTreeProtocol: 'RSTP',
          portSecurity: false
        },
      },
      firewall: {
        label: 'Firewall',
        defaultConfig: {
          name: '',
          rules: [
            { action: 'allow', source: 'internal', destination: 'external', port: '80,443', protocol: 'tcp' }
          ],
          zones: ['internal', 'external', 'dmz'],
          natEnabled: true,
          vpnSupport: false,
          intrusionDetection: false
        },
      },
      dns: {
        label: 'DNS Server',
        defaultConfig: {
          name: '',
          zones: [
            { name: 'example.local', type: 'forward' }
          ],
          forwarders: ['8.8.8.8', '1.1.1.1'],
          recursion: true,
          dnssec: false
        },
      },
      dhcp: {
        label: 'DHCP Server',
        defaultConfig: {
          name: '',
          scope: '192.168.1.100-200',
          leaseTime: '24h',
          gateway: '192.168.1.1',
          dnsServers: ['192.168.1.1']
        },
      },
      loadbalancer: {
        label: 'Load Balancer',
        defaultConfig: {
          name: '',
          algorithm: 'round-robin',
          healthCheck: true,
          servers: [],
          sslTermination: false,
        },
      },
      docker: {
        label: 'Docker Container',
        defaultConfig: {
          name: '',
          image: 'nginx:latest',
          ports: '80:80',
          env: '',
          network: 'bridge',
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
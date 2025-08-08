import { ref } from 'vue'
import { useVueFlow, applyNodeChanges, applyEdgeChanges, addEdge } from '@vue-flow/core'

export function useInfraBuilder() {
  const { updateNodeData } = useVueFlow()
  
  const nodes = ref([])
  const edges = ref([])
  const selectedNode = ref(null)

  const handleConnect = (connection) => {
    // Keep edges controlled via local state
    edges.value = addEdge(connection, edges.value)
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
    onConnect: handleConnect,
    onNodeClick: handleNodeClick,
    updateNodeStatus,
    loadProjectData,
    onNodesChange: handleNodesChange,
    onEdgesChange: handleEdgesChange
  }
}
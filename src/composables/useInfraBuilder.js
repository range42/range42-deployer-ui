import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

export function useInfraBuilder() {
  const { onConnect, addEdges, updateNodeData, onNodesChange, onEdgesChange } = useVueFlow()
  
  const nodes = ref([])
  const edges = ref([])
  const selectedNode = ref(null)

  const handleConnect = (connection) => {
    addEdges([connection])
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
    onNodesChange(changes)
  }

  const handleEdgesChange = (changes) => {
    onEdgesChange(changes)
  }

  onConnect(handleConnect)

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
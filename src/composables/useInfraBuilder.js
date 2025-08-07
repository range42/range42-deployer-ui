// composables/useInfraBuilder.js
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
    
    // Update the local selectedNode if it's the one being updated
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
    nodes.value = project.nodes || []
    edges.value = project.edges || []
    selectedNode.value = null
  }

  // Handle nodes change
  const handleNodesChange = (changes) => {
    onNodesChange(changes)
  }

  // Handle edges change  
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
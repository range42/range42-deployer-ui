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
  }

  const loadProjectData = (project) => {
    nodes.value = project.nodes || []
    edges.value = project.edges || []
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
    onNodesChange,
    onEdgesChange
  }
}
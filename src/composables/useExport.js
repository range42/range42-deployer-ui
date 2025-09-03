import { ref, computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { generateTopologyExport } from '../rules/topologyRules'

export function useExport() {
  const { getNodes, getEdges } = useVueFlow()
  const isExporting = ref(false)
  const exportErrors = ref([])

  // Topology-only export (no Ansible/Compose/Docs)
  const exportTopologyOnly = async (project, override = {}) => {
    isExporting.value = true
    exportErrors.value = []
    try {
      const vfNodes = (getNodes && Array.isArray(getNodes.value)) ? getNodes.value : []
      const vfEdges = (getEdges && Array.isArray(getEdges.value)) ? getEdges.value : []
      const nodes = (override && Array.isArray(override.nodes) && override.nodes.length) ? override.nodes 
        : (vfNodes && vfNodes.length ? vfNodes 
        : (project && Array.isArray(project.nodes) ? project.nodes : []))
      const edges = (override && Array.isArray(override.edges) && override.edges.length) ? override.edges 
        : (vfEdges && vfEdges.length ? vfEdges 
        : (project && Array.isArray(project.edges) ? project.edges : []))

      const topology = generateTopologyExport(nodes, edges)

      const hostCount = nodes.filter(n => n.type === 'vm').length
      const serviceTypes = ['docker', 'dns', 'dhcp', 'loadbalancer']
      const serviceCount = nodes.filter(n => serviceTypes.includes(n.type)).length
      const networkCount = nodes.filter(n => n.type === 'network-segment').length

      const metadata = {
        projectName: project?.name || 'project',
        exportedAt: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        hostCount,
        serviceCount,
        networkCount
      }

      return {
        metadata,
        topology,
        topologyJson: JSON.stringify(topology, null, 2)
      }
    } catch (error) {
      exportErrors.value = [error.message]
      return null
    } finally {
      isExporting.value = false
    }
  }

  // Download a single topology.json
  const downloadTopology = (exportData, projectName) => {
    if (!exportData || !exportData.topologyJson) return
    const blob = new Blob([exportData.topologyJson], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = (projectName || 'project') + '-topology-' + Date.now() + '.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }


  

  return {
    isExporting: computed(() => isExporting.value),
    exportErrors: computed(() => exportErrors.value),
    exportTopologyOnly,
    downloadTopology
  }
}
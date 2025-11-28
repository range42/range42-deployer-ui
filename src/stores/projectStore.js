import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useProjectStore = defineStore('projects', () => {
  const projects = ref([])

  const loadProjects = () => {
    try {
      const saved = localStorage.getItem('range42_projects')
      if (saved) {
        projects.value = JSON.parse(saved)
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
      projects.value = []
    }
  }

  const saveProjects = () => {
    try {
      localStorage.setItem('range42_projects', JSON.stringify(projects.value))
    } catch (error) {
      console.error('Failed to save projects:', error)
    }
  }

  const createProject = (name) => {
    const project = {
      id: `project_${Date.now()}`,
      name,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      nodes: [],
      edges: []
    }

    projects.value.push(project)
    saveProjects()
    return project
  }

  const getProject = (id) => {
    return projects.value.find(p => p.id === id)
  }

  const updateProject = (id, updates) => {
    const index = projects.value.findIndex(p => p.id === id)
    if (index !== -1) {
      Object.assign(
        projects.value[index],
        updates,
        { modified: new Date().toISOString() }
      )
      saveProjects()
    }
  }

  const deleteProject = (id) => {
    const index = projects.value.findIndex(p => p.id === id)
    if (index !== -1) {
      projects.value.splice(index, 1)
      saveProjects()
    }
  }

  const exportProject = (id) => {
    const project = getProject(id)
    if (!project) return

    const dataStr = JSON.stringify(project, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr)

    const exportFileDefaultName = `${project.name.replace(/\s+/g, '_')}.json`

    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.click()
  }

  const clearAllData = () => {
    projects.value = []
    saveProjects()
  }

  /**
   * Update a single node's status within a project
   * @param {string} projectId - Project ID
   * @param {string} nodeId - Node ID to update
   * @param {string} status - New status ('draft' | 'pending' | 'deploying' | 'running' | 'stopped' | 'error')
   */
  const updateNodeStatus = (projectId, nodeId, status) => {
    const project = getProject(projectId)
    if (!project) return false

    const node = project.nodes.find(n => n.id === nodeId)
    if (!node) return false

    // Update the node's data.status
    if (node.data) {
      node.data.status = status
    }

    // Save changes
    updateProject(projectId, { nodes: project.nodes })
    return true
  }

  /**
   * Update multiple node statuses at once
   * @param {string} projectId - Project ID
   * @param {Array<{nodeId: string, status: string}>} updates - Array of node status updates
   */
  const updateNodeStatuses = (projectId, updates) => {
    const project = getProject(projectId)
    if (!project) return false

    for (const { nodeId, status } of updates) {
      const node = project.nodes.find(n => n.id === nodeId)
      if (node && node.data) {
        node.data.status = status
      }
    }

    // Save all changes at once
    updateProject(projectId, { nodes: project.nodes })
    return true
  }

  /**
   * Associate a Proxmox VM ID with a canvas node
   * @param {string} projectId - Project ID
   * @param {string} nodeId - Canvas node ID
   * @param {number} vmId - Proxmox VM ID
   */
  const setNodeVmId = (projectId, nodeId, vmId) => {
    const project = getProject(projectId)
    if (!project) return false

    const node = project.nodes.find(n => n.id === nodeId)
    if (!node) return false

    if (node.data) {
      node.data.vmId = vmId
    }

    updateProject(projectId, { nodes: project.nodes })
    return true
  }

  return {
    projects: computed(() => projects.value),
    loadProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    exportProject,
    clearAllData,
    updateNodeStatus,
    updateNodeStatuses,
    setNodeVmId
  }
})

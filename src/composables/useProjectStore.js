import { reactive } from 'vue'

export function useProjectStore() {
  const currentProject = reactive({
    id: null,
    name: 'Infrastructure Project',
    created: null,
    modified: null
  })

  const saveProject = (nodes, edges) => {
    try {
      // Create a clean snapshot without reactive references
      const projectData = {
        ...currentProject,
        nodes: JSON.parse(JSON.stringify(nodes || [])),
        edges: JSON.parse(JSON.stringify(edges || [])),
        modified: new Date().toISOString()
      }

      // Save to localStorage
      localStorage.setItem('range42-current-project', JSON.stringify(projectData))

      console.log('Project saved successfully')
      return true
    } catch (error) {
      console.error('Failed to save project:', error)
      return false
    }
  }

  const loadProject = () => {
    try {
      const savedProject = localStorage.getItem('range42-current-project')

      if (savedProject) {
        const projectData = JSON.parse(savedProject)

        // Update current project metadata
        Object.assign(currentProject, {
          id: projectData.id,
          name: projectData.name,
          created: projectData.created,
          modified: projectData.modified
        })

        console.log('Project loaded successfully')
        return {
          nodes: projectData.nodes || [],
          edges: projectData.edges || []
        }
      } else {
        // Initialize new project
        currentProject.id = `project-${Date.now()}`
        currentProject.created = new Date().toISOString()
        currentProject.modified = new Date().toISOString()

        console.log('New project initialized')
        return { nodes: [], edges: [] }
      }
    } catch (error) {
      console.error('Failed to load project:', error)

      // Initialize new project on error
      currentProject.id = `project-${Date.now()}`
      currentProject.created = new Date().toISOString()
      currentProject.modified = new Date().toISOString()

      return { nodes: [], edges: [] }
    }
  }

  const createNewProject = (name = 'New Infrastructure Project') => {
    currentProject.id = `project-${Date.now()}`
    currentProject.name = name
    currentProject.created = new Date().toISOString()
    currentProject.modified = new Date().toISOString()

    // Clear localStorage
    localStorage.removeItem('range42-current-project')

    return { nodes: [], edges: [] }
  }

  const exportProjectData = (nodes, edges) => {
    const projectData = {
      ...currentProject,
      nodes: JSON.parse(JSON.stringify(nodes || [])),
      edges: JSON.parse(JSON.stringify(edges || [])),
      exported: new Date().toISOString()
    }

    return JSON.stringify(projectData, null, 2)
  }

  const importProjectData = (jsonData) => {
    try {
      const projectData = JSON.parse(jsonData)

      // Validate project data
      if (!projectData.nodes || !projectData.edges) {
        throw new Error('Invalid project data format')
      }

      // Update current project metadata
      Object.assign(currentProject, {
        id: projectData.id || `project-${Date.now()}`,
        name: projectData.name || 'Imported Project',
        created: projectData.created || new Date().toISOString(),
        modified: new Date().toISOString()
      })

      console.log('Project imported successfully')
      return {
        nodes: projectData.nodes,
        edges: projectData.edges
      }
    } catch (error) {
      console.error('Failed to import project:', error)
      return null
    }
  }

  return {
    currentProject,
    saveProject,
    loadProject,
    createNewProject,
    exportProjectData,
    importProjectData
  }
}

/**
 * Inventory Store
 * 
 * Manages GitHub-hosted inventory repositories for reusable infrastructure components.
 * Supports read and write operations to Git repositories.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  getGitProvider,
  parseRepoUrl,
  detectProviderFromUrl,
  type GitProvider,
  type GitProviderName,
  type RegisteredInventory,
  type InventoryManifest,
  type InventoryComponent,
  type InventoryScenario,
  GitNotFoundError,
} from '@/services/git'

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'range42_inventories'

// =============================================================================
// Types
// =============================================================================

export interface CachedComponent {
  repoId: string
  path: string
  component: InventoryComponent
  fetchedAt: string
}

export interface ComponentListItem {
  id: string
  name: string
  type: string
  path: string
  repoId: string
}

// =============================================================================
// Store
// =============================================================================

export const useInventoryStore = defineStore('inventory', () => {
  // ===========================================================================
  // State
  // ===========================================================================
  
  const registeredRepos = ref<RegisteredInventory[]>(loadFromStorage())
  const cachedComponents = ref<Map<string, CachedComponent>>(new Map())
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  
  // ===========================================================================
  // Computed
  // ===========================================================================
  
  const repoCount = computed(() => registeredRepos.value.length)
  
  const allComponents = computed(() => {
    return Array.from(cachedComponents.value.values())
  })
  
  const componentsByType = computed(() => {
    const grouped: Record<string, CachedComponent[]> = {
      vm: [],
      lxc: [],
      network: [],
      service: [],
      scenario: [],
    }
    
    const cachedValues = Array.from(cachedComponents.value.values())
    for (const cached of cachedValues) {
      const type = cached.component.type
      if (grouped[type]) {
        grouped[type].push(cached)
      }
    }
    
    return grouped
  })
  
  // ===========================================================================
  // Persistence
  // ===========================================================================
  
  function loadFromStorage(): RegisteredInventory[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (e) {
      console.warn('[InventoryStore] Failed to load from storage:', e)
    }
    return []
  }
  
  function saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(registeredRepos.value))
    } catch (e) {
      console.warn('[InventoryStore] Failed to save to storage:', e)
    }
  }
  
  // ===========================================================================
  // Provider Helpers
  // ===========================================================================
  
  function getProviderForRepo(repoId: string): GitProvider {
    const repo = registeredRepos.value.find(r => r.id === repoId)
    const providerName = repo?.provider || 'github'
    return getGitProvider(providerName)
  }
  
  // ===========================================================================
  // Repository Management
  // ===========================================================================
  
  /**
   * Add a new inventory repository
   */
  async function addRepository(repoUrl: string): Promise<RegisteredInventory> {
    const parsed = parseRepoUrl(repoUrl)
    if (!parsed) {
      throw new Error('Invalid repository URL')
    }
    
    const { owner, repo } = parsed
    const repoId = `${owner}/${repo}`
    
    // Check if already registered
    if (registeredRepos.value.some(r => r.id === repoId)) {
      throw new Error('Repository already registered')
    }
    
    const providerName = detectProviderFromUrl(repoUrl) || 'github'
    const provider = getGitProvider(providerName)
    
    try {
      isLoading.value = true
      error.value = null
      
      // Get repo info to determine default branch
      const repoInfo = await provider.getRepoInfo(owner, repo)
      
      // Fetch manifest
      const manifestContent = await provider.getFile(owner, repo, 'manifest.json', repoInfo.defaultBranch)
      const manifest: InventoryManifest = JSON.parse(manifestContent)
      
      // Check write access
      const isWritable = await provider.canWrite(owner, repo)
      
      const registered: RegisteredInventory = {
        id: repoId,
        owner,
        repo,
        branch: repoInfo.defaultBranch,
        manifest,
        addedAt: new Date().toISOString(),
        provider: providerName,
        isWritable,
      }
      
      registeredRepos.value.push(registered)
      saveToStorage()
      
      return registered
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * Remove a registered repository
   */
  function removeRepository(repoId: string): void {
    const index = registeredRepos.value.findIndex(r => r.id === repoId)
    if (index >= 0) {
      registeredRepos.value.splice(index, 1)
      saveToStorage()
      
      // Clear cached components from this repo
      const keysToDelete: string[] = []
      const cachedEntries = Array.from(cachedComponents.value.entries())
      for (const [key, cached] of cachedEntries) {
        if (cached.repoId === repoId) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach(key => cachedComponents.value.delete(key))
    }
  }
  
  /**
   * Refresh a repository's manifest
   */
  async function refreshRepository(repoId: string): Promise<void> {
    const repo = registeredRepos.value.find(r => r.id === repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    const provider = getProviderForRepo(repoId)
    
    try {
      isLoading.value = true
      error.value = null
      
      const manifestContent = await provider.getFile(repo.owner, repo.repo, 'manifest.json', repo.branch)
      repo.manifest = JSON.parse(manifestContent)
      repo.lastSyncAt = new Date().toISOString()
      repo.isWritable = await provider.canWrite(repo.owner, repo.repo)
      
      saveToStorage()
    } finally {
      isLoading.value = false
    }
  }
  
  // ===========================================================================
  // Component Operations
  // ===========================================================================
  
  /**
   * List components in a repository directory
   */
  async function listComponents(
    repoId: string, 
    type: 'vms' | 'networks' | 'services' | 'scenarios'
  ): Promise<ComponentListItem[]> {
    const repo = registeredRepos.value.find(r => r.id === repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    const provider = getProviderForRepo(repoId)
    const path = type === 'scenarios' ? 'scenarios' : `components/${type}`
    
    try {
      const files = await provider.listFiles(repo.owner, repo.repo, path, repo.branch)
      
      return files
        .filter(f => f.type === 'file' && f.name.endsWith('.json'))
        .map(f => ({
          id: f.name.replace('.json', ''),
          name: f.name.replace('.json', ''),
          type: type.replace(/s$/, ''),  // vms -> vm
          path: f.path,
          repoId,
        }))
    } catch (e) {
      if (e instanceof GitNotFoundError) {
        return []  // Directory doesn't exist
      }
      throw e
    }
  }
  
  /**
   * Fetch a single component
   */
  async function fetchComponent(repoId: string, path: string): Promise<InventoryComponent> {
    const cacheKey = `${repoId}/${path}`
    
    // Check cache
    const cached = cachedComponents.value.get(cacheKey)
    if (cached) {
      return cached.component
    }
    
    const repo = registeredRepos.value.find(r => r.id === repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    const provider = getProviderForRepo(repoId)
    
    try {
      isLoading.value = true
      
      const content = await provider.getFile(repo.owner, repo.repo, path, repo.branch)
      const component: InventoryComponent = JSON.parse(content)
      
      // Cache the component
      cachedComponents.value.set(cacheKey, {
        repoId,
        path,
        component,
        fetchedAt: new Date().toISOString(),
      })
      
      return component
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * Load all components from a repository
   */
  async function loadAllComponents(repoId: string): Promise<void> {
    const types: Array<'vms' | 'networks' | 'services' | 'scenarios'> = ['vms', 'networks', 'services', 'scenarios']
    
    isLoading.value = true
    error.value = null
    
    try {
      for (const type of types) {
        const items = await listComponents(repoId, type)
        
        // Fetch each component
        await Promise.all(
          items.map(item => fetchComponent(repoId, item.path).catch(e => {
            console.warn(`[InventoryStore] Failed to fetch ${item.path}:`, e)
          }))
        )
      }
    } finally {
      isLoading.value = false
    }
  }
  
  // ===========================================================================
  // Scenario Operations
  // ===========================================================================
  
  /**
   * Load a scenario and resolve all component references
   */
  async function loadScenario(repoId: string, scenarioId: string): Promise<{
    scenario: InventoryScenario
    resolvedNodes: Array<{
      id: string
      type: string
      label: string
      position: { x: number; y: number }
      data: { config: Record<string, unknown>; status: string }
    }>
    edges: Array<{ source: string; target: string; data?: Record<string, unknown> }>
  }> {
    const scenario = await fetchComponent(repoId, `scenarios/${scenarioId}.json`) as InventoryScenario
    
    // Resolve component references
    const resolvedNodes = await Promise.all(
      scenario.nodes.map(async (node) => {
        // Determine component path based on type hint or default to vms
        let componentPath = `components/vms/${node.component}.json`
        
        try {
          const component = await fetchComponent(repoId, componentPath)
          
          return {
            id: node.id,
            type: component.type,
            label: component.name,
            position: node.position,
            data: {
              config: { ...component.config, ...node.overrides },
              status: 'gray',
            },
          }
        } catch {
          // Try networks
          try {
            componentPath = `components/networks/${node.component}.json`
            const component = await fetchComponent(repoId, componentPath)
            
            return {
              id: node.id,
              type: component.type === 'network' ? 'network-segment' : component.type,
              label: component.name,
              position: node.position,
              data: {
                config: { ...component.config, ...node.overrides },
                status: 'gray',
              },
            }
          } catch {
            // Fallback to placeholder
            return {
              id: node.id,
              type: 'vm',
              label: node.component,
              position: node.position,
              data: {
                config: { name: node.component, ...node.overrides },
                status: 'gray',
              },
            }
          }
        }
      })
    )
    
    return {
      scenario,
      resolvedNodes,
      edges: scenario.edges,
    }
  }
  
  // ===========================================================================
  // Write Operations
  // ===========================================================================
  
  /**
   * Publish a component to a repository
   */
  async function publishComponent(
    repoId: string,
    component: InventoryComponent,
    commitMessage?: string
  ): Promise<void> {
    const repo = registeredRepos.value.find(r => r.id === repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    if (!repo.isWritable) {
      throw new Error('No write access to this repository')
    }
    
    const provider = getProviderForRepo(repoId)
    const typeDir = component.type === 'scenario' ? 'scenarios' : `components/${component.type}s`
    const path = `${typeDir}/${component.id}.json`
    const content = JSON.stringify(component, null, 2)
    const message = commitMessage || `Add ${component.type}: ${component.name}`
    
    try {
      isLoading.value = true
      
      await provider.createOrUpdateFile(repo.owner, repo.repo, path, content, message, repo.branch)
      
      // Invalidate cache
      const cacheKey = `${repoId}/${path}`
      cachedComponents.value.delete(cacheKey)
      
      // Refresh manifest
      await refreshRepository(repoId)
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * Delete a component from a repository
   */
  async function deleteComponent(
    repoId: string,
    componentType: string,
    componentId: string,
    commitMessage?: string
  ): Promise<void> {
    const repo = registeredRepos.value.find(r => r.id === repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    if (!repo.isWritable) {
      throw new Error('No write access to this repository')
    }
    
    const provider = getProviderForRepo(repoId)
    const typeDir = componentType === 'scenario' ? 'scenarios' : `components/${componentType}s`
    const path = `${typeDir}/${componentId}.json`
    const message = commitMessage || `Delete ${componentType}: ${componentId}`
    
    try {
      isLoading.value = true
      
      await provider.deleteFile(repo.owner, repo.repo, path, message, repo.branch)
      
      // Remove from cache
      const cacheKey = `${repoId}/${path}`
      cachedComponents.value.delete(cacheKey)
    } finally {
      isLoading.value = false
    }
  }
  
  /**
   * Fork an inventory repository
   */
  async function forkInventory(repoId: string): Promise<RegisteredInventory> {
    const repo = registeredRepos.value.find(r => r.id === repoId)
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    const provider = getProviderForRepo(repoId)
    
    try {
      isLoading.value = true
      
      const forked = await provider.forkRepo(repo.owner, repo.repo)
      
      // Add forked repo
      return await addRepository(`${forked.owner}/${forked.name}`)
    } finally {
      isLoading.value = false
    }
  }
  
  // ===========================================================================
  // Cache Management
  // ===========================================================================
  
  function clearCache(): void {
    cachedComponents.value.clear()
  }
  
  function getCachedComponent(repoId: string, path: string): InventoryComponent | null {
    const cached = cachedComponents.value.get(`${repoId}/${path}`)
    return cached?.component || null
  }
  
  // ===========================================================================
  // Return
  // ===========================================================================
  
  return {
    // State
    registeredRepos,
    cachedComponents,
    isLoading,
    error,
    
    // Computed
    repoCount,
    allComponents,
    componentsByType,
    
    // Repository management
    addRepository,
    removeRepository,
    refreshRepository,
    
    // Component operations
    listComponents,
    fetchComponent,
    loadAllComponents,
    
    // Scenario operations
    loadScenario,
    
    // Write operations
    publishComponent,
    deleteComponent,
    forkInventory,
    
    // Cache
    clearCache,
    getCachedComponent,
  }
})

export default useInventoryStore

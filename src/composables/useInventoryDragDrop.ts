/**
 * Inventory Drag & Drop Composable
 * 
 * Handles dragging inventory components from the InventoryBrowser to the canvas.
 * Integrates with useDragAndDrop for node creation.
 */

import { ref } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import type { InventoryComponent } from '@/services/git'

// =============================================================================
// Types
// =============================================================================

export interface InventoryDragData {
  type: 'inventory-component'
  repoId: string
  path: string
  componentType: string
  componentId: string
}

export interface CanvasNodeFromInventory {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
  data: {
    type: string
    label: string
    status: string
    config: Record<string, unknown>
    inventoryRef?: {
      repoId: string
      componentId: string
      componentPath: string
    }
  }
}

// =============================================================================
// Composable
// =============================================================================

export function useInventoryDragDrop() {
  const inventoryStore = useInventoryStore()
  const isProcessing = ref(false)
  const error = ref<string | null>(null)

  /**
   * Check if drag data is from inventory
   */
  function isInventoryDrag(event: DragEvent): boolean {
    if (!event.dataTransfer) return false
    
    try {
      const data = event.dataTransfer.getData('application/json')
      if (!data) return false
      
      const parsed = JSON.parse(data)
      return parsed.type === 'inventory-component'
    } catch {
      return false
    }
  }

  /**
   * Parse inventory drag data
   */
  function parseInventoryDragData(event: DragEvent): InventoryDragData | null {
    if (!event.dataTransfer) return null
    
    try {
      const data = event.dataTransfer.getData('application/json')
      if (!data) return null
      
      const parsed = JSON.parse(data)
      if (parsed.type !== 'inventory-component') return null
      
      return parsed as InventoryDragData
    } catch {
      return null
    }
  }

  /**
   * Create canvas node from inventory component
   */
  async function createNodeFromInventory(
    dragData: InventoryDragData,
    position: { x: number; y: number }
  ): Promise<CanvasNodeFromInventory | null> {
    try {
      isProcessing.value = true
      error.value = null

      // Fetch the component
      const component = await inventoryStore.fetchComponent(dragData.repoId, dragData.path)
      
      // Map inventory type to canvas type
      const canvasType = mapInventoryTypeToCanvasType(component.type)
      
      // Generate unique ID
      const nodeId = `${component.type}-${component.id}-${Date.now()}`
      
      return {
        id: nodeId,
        type: canvasType,
        label: component.name,
        position,
        data: {
          type: canvasType,
          label: component.name,
          status: 'gray',
          config: {
            name: component.name,
            ...component.config,
          },
          inventoryRef: {
            repoId: dragData.repoId,
            componentId: component.id,
            componentPath: dragData.path,
          },
        },
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[useInventoryDragDrop] Failed to create node:', err)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  /**
   * Handle drop event on canvas
   */
  async function handleCanvasDrop(
    event: DragEvent,
    canvasPosition: { x: number; y: number }
  ): Promise<CanvasNodeFromInventory | null> {
    const dragData = parseInventoryDragData(event)
    if (!dragData) return null
    
    return createNodeFromInventory(dragData, canvasPosition)
  }

  /**
   * Map inventory component type to canvas node type
   */
  function mapInventoryTypeToCanvasType(inventoryType: string): string {
    switch (inventoryType) {
      case 'vm':
        return 'vm'
      case 'lxc':
        return 'lxc'
      case 'network':
        return 'network-segment'
      case 'service':
        return 'vm' // Services typically deploy as VMs
      default:
        return 'vm'
    }
  }

  /**
   * Convert inventory component to canvas-compatible config
   */
  function convertToCanvasConfig(component: InventoryComponent): Record<string, unknown> {
    const baseConfig = {
      name: component.name,
      ...component.config,
    }

    // Handle VM-specific fields
    if (component.type === 'vm') {
      return {
        ...baseConfig,
        vm_cores: component.config.cores || 2,
        vm_sockets: component.config.sockets || 1,
        vm_memory: component.config.memory || 2048,
        vm_cpu: component.config.cpu || 'host',
      }
    }

    // Handle LXC-specific fields
    if (component.type === 'lxc') {
      return {
        ...baseConfig,
        cores: component.config.cores || 1,
        memory: component.config.memory || 512,
        swap: component.config.swap || 512,
        ostemplate: component.config.ostemplate || '',
      }
    }

    // Handle network-specific fields
    if (component.type === 'network') {
      return {
        ...baseConfig,
        bridge: component.config.bridge || 'vmbr0',
        cidr: component.config.cidr || '',
        gateway: component.config.gateway || '',
      }
    }

    return baseConfig
  }

  /**
   * Load a complete scenario onto the canvas
   */
  async function loadScenarioToCanvas(
    repoId: string,
    scenarioId: string
  ): Promise<{
    nodes: CanvasNodeFromInventory[]
    edges: Array<{ source: string; target: string; data?: Record<string, unknown> }>
  } | null> {
    try {
      isProcessing.value = true
      error.value = null

      const result = await inventoryStore.loadScenario(repoId, scenarioId)
      
      // Convert to canvas format
      const nodes: CanvasNodeFromInventory[] = result.resolvedNodes.map(node => ({
        id: node.id,
        type: node.type === 'network' ? 'network-segment' : node.type,
        label: node.label,
        position: node.position,
        data: {
          type: node.type === 'network' ? 'network-segment' : node.type,
          label: node.label,
          status: 'gray',
          config: node.data.config,
          inventoryRef: {
            repoId,
            componentId: node.id,
            componentPath: `scenarios/${scenarioId}.json`,
          },
        },
      }))

      return {
        nodes,
        edges: result.edges,
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('[useInventoryDragDrop] Failed to load scenario:', err)
      return null
    } finally {
      isProcessing.value = false
    }
  }

  return {
    // State
    isProcessing,
    error,

    // Methods
    isInventoryDrag,
    parseInventoryDragData,
    createNodeFromInventory,
    handleCanvasDrop,
    mapInventoryTypeToCanvasType,
    convertToCanvasConfig,
    loadScenarioToCanvas,
  }
}

export default useInventoryDragDrop

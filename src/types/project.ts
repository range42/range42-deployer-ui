import type { CanvasModel } from '@/overlay/serialize'
import type { ProjectFiles } from '@/services/projectFiles'

/** Local authoring data; observed runtime identity is not a deployment proof. */
export interface ProjectDraft extends CanvasModel {
  id: string
  name: string
  files?: ProjectFiles
  baseDoc?: Record<string, unknown> & { env?: unknown }
  scenario?: Record<string, unknown>
  scenario_generated_paths?: string[]
  overlay?: Record<string, unknown>
  catalogImports?: unknown
  [key: string]: unknown
}

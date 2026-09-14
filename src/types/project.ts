import type { CanvasModel } from '@/overlay/serialize'
import type { ProjectFiles } from '@/services/projectFiles'
import type { ProjectGitBinding } from '@/composables/useProjectGitSync'
import type { CatalogImportReference } from '@/services/catalogReference'

/** Local authoring data; observed runtime identity is not a deployment proof. */
export interface ProjectDraft extends CanvasModel {
  id: string
  name: string
  files?: ProjectFiles
  baseDoc?: Record<string, unknown> & { env?: unknown }
  scenario?: Record<string, unknown> & { label?: string; allocation?: Record<string, unknown> }
  scenario_generated_paths?: string[]
  overlay?: Record<string, unknown>
  git?: ProjectGitBinding
  head_sha?: string
  project_sha?: string
  catalog_sha?: string
  pinned_catalog_sha?: string
  bridge_base?: number
  gamenet?: boolean
  catalogRef?: Record<string, string | number>
  catalogImports?: CatalogImportReference[]
  git_opened?: { branch: string; commit_sha: string; mode: string; authoring_status: string }
  gitSource?: { provider: 'github' | 'gitlab' | 'gitea' | 'generic'; owner: string; repo: string; path?: string; ref?: string; baseUrl?: string; token?: string }
  [key: string]: unknown
}

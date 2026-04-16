/**
 * In-memory VirtualFs backing the ConfigTab when the project uses local
 * draft storage (no git adapter yet wired, or offline). Shape mirrors
 * what FileTree / TwoPaneEditor / ConfigTab expect:
 *
 *   VirtualFs = {
 *     listTree(): Promise<TreeEntry[]>
 *     getFile(path): Promise<{ content, sha }>
 *     putFile({ path, content, message }): Promise<{ sha }>
 *   }
 *
 * The backing store is a `{ path -> content }` object shared with the
 * caller so changes propagate reactively. SHAs are derived from a simple
 * hash of the content — enough to detect drift at the semantic layer.
 */

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

export interface VirtualFs {
  listTree(): Promise<TreeEntry[]>
  getFile(path: string): Promise<{ content: string; sha: string }>
  putFile(opts: {
    path: string
    content: string
    message?: string
  }): Promise<{ sha: string }>
}

export interface MemoryFsStore {
  files: Record<string, string>
  onChange?: (files: Record<string, string>) => void
}

function cheapSha(content: string): string {
  // djb2 — stable per content, enough for UI-only SHA comparisons. Not a
  // security boundary.
  let h = 5381
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return `mem-${hex}`
}

export function createMemoryFs(store: MemoryFsStore): VirtualFs {
  return {
    async listTree() {
      const out: TreeEntry[] = []
      for (const [path, content] of Object.entries(store.files || {})) {
        out.push({ path, type: 'blob', sha: cheapSha(content) })
      }
      return out
    },
    async getFile(path: string) {
      const content = (store.files || {})[path]
      if (content == null) throw new Error(`not found: ${path}`)
      return { content, sha: cheapSha(content) }
    },
    async putFile(opts: { path: string; content: string; message?: string }) {
      if (!store.files) store.files = {}
      store.files[opts.path] = opts.content
      if (store.onChange) store.onChange(store.files)
      return { sha: cheapSha(opts.content) }
    },
  }
}

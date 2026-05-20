/**
 * File-tree merge logic shared between the ConfigTab FileTree component
 * and its unit tests. Pure functions, no Vue dependencies, so they can be
 * exercised without mounting the component.
 *
 * An entry returned by a VirtualFs-style `listTree` call is:
 *   { path: string, type: 'blob' | 'tree', sha: string }
 *
 * `mergeTrees(base, overlay)` produces a merged, sorted list with a marker
 * describing which side(s) the entry originated from:
 *   - 'base'           : present only in base (read-only)
 *   - 'overlay'        : present only in overlay (overlay-only)
 *   - 'overlay_override' : present in both (overlay overrides base)
 */

export type FsKind = 'base' | 'overlay'
export type MergeMarker = 'base' | 'overlay' | 'overlay_override'

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

export interface MergedEntry extends TreeEntry {
  marker: MergeMarker
  baseSha?: string
  overlaySha?: string
}

export function mergeTrees(
  base: TreeEntry[],
  overlay: TreeEntry[],
): MergedEntry[] {
  const byPath = new Map<string, MergedEntry>()
  for (const entry of base) {
    byPath.set(entry.path, {
      ...entry,
      marker: 'base',
      baseSha: entry.sha,
    })
  }
  for (const entry of overlay) {
    const existing = byPath.get(entry.path)
    if (existing) {
      byPath.set(entry.path, {
        ...entry,
        marker: 'overlay_override',
        baseSha: existing.baseSha,
        overlaySha: entry.sha,
      })
    } else {
      byPath.set(entry.path, {
        ...entry,
        marker: 'overlay',
        overlaySha: entry.sha,
      })
    }
  }
  const out = Array.from(byPath.values())
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/**
 * Produces the overlay-fork header block for a file that was forked from
 * the base filesystem. Captures the base SHA so the UI can later detect
 * drift when upstream changes.
 */
export function buildForkHeader(
  path: string,
  baseSha: string,
  now: string = new Date().toISOString(),
): string {
  const banner = '# Range42: forked from base overlay'
  const lines = [
    banner,
    `# path: ${path}`,
    `# forked_from_sha: ${baseSha}`,
    `# forked_at: ${now}`,
    '# Edit below. Remove this header block to detach from upstream tracking.',
    '',
  ]
  return lines.join('\n')
}

/**
 * Returns the stored upstream-tracking SHA, if any, from an overlay file's
 * header. Used by the drift banner in ConfigTab (C3.8) to compare against
 * the current upstream HEAD SHA.
 */
export function readForkHeaderSha(content: string): string | null {
  const lines = content.split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^#\s*forked_from_sha:\s*(\S+)\s*$/)
    if (m) return m[1]
    if (!line.startsWith('#')) break
  }
  return null
}

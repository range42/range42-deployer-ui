export interface TagDefinition {
  name: string
  color: string      // Tailwind bg class suffix, e.g. 'blue-500'
  hex: string        // For non-Tailwind contexts
  description: string
}

export const PREDEFINED_TAGS: TagDefinition[] = [
  { name: 'admin',      color: 'blue-500',   hex: '#3b82f6', description: 'Infrastructure administration' },
  { name: 'student',    color: 'green-500',  hex: '#22c55e', description: 'Student lab machines' },
  { name: 'vuln',       color: 'red-500',    hex: '#ef4444', description: 'Vulnerable targets' },
  { name: 'ctf',        color: 'amber-500',  hex: '#f59e0b', description: 'CTF challenge machines' },
  { name: 'monitoring', color: 'violet-500', hex: '#8b5cf6', description: 'Monitoring & observability' },
  { name: 'gateway',    color: 'cyan-500',   hex: '#06b6d4', description: 'Network gateways & proxies' },
]

// Neutral colors for custom tags, cycled through
const CUSTOM_PALETTE = ['#64748b', '#78716c', '#71717a', '#737373', '#6b7280']

export function getTagColor(tagName: string): { color: string; hex: string } {
  const predefined = PREDEFINED_TAGS.find(t => t.name === tagName)
  if (predefined) return { color: predefined.color, hex: predefined.hex }

  // Deterministic color from name hash
  let hash = 0
  for (let i = 0; i < tagName.length; i++) hash = ((hash << 5) - hash + tagName.charCodeAt(i)) | 0
  const hex = CUSTOM_PALETTE[Math.abs(hash) % CUSTOM_PALETTE.length]
  return { color: 'slate-500', hex }
}

export function parseTags(proxmoxTags: string): string[] {
  if (!proxmoxTags) return []
  // Proxmox uses semicolons internally
  return proxmoxTags.split(';').map(t => t.trim()).filter(Boolean)
}

export function formatTagsForBackend(tags: string[]): string {
  // Backend VmSetTagRequest expects comma-separated
  return tags.join(',')
}

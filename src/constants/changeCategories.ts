export type ChangeCategory = 'live' | 'restart' | 'redeploy'

interface ChangeCategoryDef {
  category: ChangeCategory
  label: string
}

export const CHANGE_CATEGORIES: Record<string, ChangeCategoryDef> = {
  tags:        { category: 'live',    label: 'Tags' },
  name:        { category: 'live',    label: 'Name' },
  description: { category: 'live',    label: 'Description' },
  cores:       { category: 'restart', label: 'CPU Cores' },
  memory:      { category: 'restart', label: 'Memory' },
}

export function getChangeCategory(field: string): ChangeCategory {
  return CHANGE_CATEGORIES[field]?.category ?? 'redeploy'
}

export function getChangeLabel(field: string): string {
  return CHANGE_CATEGORIES[field]?.label ?? field
}

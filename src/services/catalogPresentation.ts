import type { LocationQuery, LocationQueryRaw } from 'vue-router'

export const catalogKinds = ['scenario', 'lab', 'gamenet', 'component', 'container', 'ansible_role']

export function catalogCapabilities(kind: string) {
  return { append: kind !== 'scenario' && catalogKinds.includes(kind), create: ['scenario', 'lab', 'gamenet', 'component', 'ansible_role'].includes(kind) }
}

/** Carry browsing state through entry links without importing unrelated query data. */
export function catalogBrowseQuery(query: LocationQuery): LocationQueryRaw {
  return Object.fromEntries(['q', 'kind', 'source', 'os', 'difficulty', 'tags', 'shown']
    .filter(key => query[key] !== undefined).map(key => [key, query[key]]))
}

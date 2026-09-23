import type { RepoRef } from './types'

export interface ForkRepository extends RepoRef {
  id: number
  parentId?: number
  writable: boolean
  importStatus?: string
}

/** Reuse only a proven fork in the selected namespace; a name collision must never receive writes. */
export async function ensurePersonalFork(options: {
  upstream: { owner: string; repo: string }
  destination?: string
  currentUser: () => Promise<string>
  getRepository: (owner: string, repo: string) => Promise<ForkRepository>
  create: () => Promise<ForkRepository>
}): Promise<RepoRef> {
  const owner = options.destination?.trim() || await options.currentUser()
  if (!owner) throw new Error('The Git provider did not return an authenticated account')
  const upstream = await options.getRepository(options.upstream.owner, options.upstream.repo)
  let fork: ForkRepository | undefined
  try { fork = await options.getRepository(owner, options.upstream.repo) }
  catch (error) {
    if (!/\b404\b/.test(error instanceof Error ? error.message : String(error))) throw error
  }
  if (!fork) {
    const created = await options.create()
    if (created.owner !== owner) throw new Error('The Git provider returned a fork outside the selected fork namespace')
    try { fork = await options.getRepository(created.owner, created.repo) }
    catch (error) {
      if (/\b404\b/.test(error instanceof Error ? error.message : String(error))) {
        throw new Error(`The provider is still preparing fork ${created.owner}/${created.repo}. Retry when it is ready.`)
      }
      throw error
    }
  }
  if (fork.parentId !== upstream.id) {
    throw new Error(`Unrelated repository ${fork.owner}/${fork.repo}: it is not a fork of the selected upstream`)
  }
  if (fork.importStatus && !['none', 'finished'].includes(fork.importStatus)) {
    throw new Error(`Fork import is ${fork.importStatus}. Retry publication when the Git provider finishes preparing the fork.`)
  }
  if (!fork.writable) throw new Error(`Write permission is required for fork ${fork.owner}/${fork.repo}`)
  return { owner: fork.owner, repo: fork.repo, default_branch: fork.default_branch }
}

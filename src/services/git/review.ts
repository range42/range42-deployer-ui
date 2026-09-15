import type { PullRequestReview } from './types'

/** Preserve the exact publication the user reviewed, including across a concurrent push. */
export function assertMergeable(review: PullRequestReview, expectedHead: string): void {
  assertReviewHead(review, expectedHead)
  if (!review.can_merge) throw new Error('You do not have permission to merge this pull request.')
  if (review.state !== 'open' || !review.mergeable) {
    throw new Error('The provider has not marked this pull request ready to merge. Check approvals, checks, and conflicts.')
  }
}

export function assertReviewHead(review: PullRequestReview, expectedHead: string): void {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expectedHead) || review.head_sha !== expectedHead) {
    throw new Error('The pull request changed since this publication. Review the new commit before merging.')
  }
  if (review.state !== 'open') throw new Error('This pull request is no longer open.')
}

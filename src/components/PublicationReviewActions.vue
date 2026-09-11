<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { providerForBinding, type ProjectPublishResult } from '@/composables/useProjectGitSync'
import type { PullRequestReview, GitProviderV1 } from '@/services/git/types'

const props = defineProps<{ result: ProjectPublishResult }>()
const emit = defineEmits<{ updated: [result: ProjectPublishResult] }>()
const { t } = useI18n()
const review = ref<PullRequestReview | null>(null)
const busy = ref(false)
const error = ref('')
const method = ref<'merge' | 'squash'>('merge')
const merged = ref(false)
const syncMessage = ref('')
const syncReviewUrl = ref('')
let provider: GitProviderV1 | undefined
const eligible = computed(() => review.value?.state === 'open' && review.value.can_merge
  && review.value.mergeable && review.value.head_sha === props.result.commit_sha)
const changed = computed(() => review.value && review.value.head_sha !== props.result.commit_sha)
watch(() => props.result, () => { review.value = null; merged.value = Boolean(props.result.merged) }, { immediate: true })

async function check() {
  const result = props.result
  const target = result.destination
  if (!target || !props.result.pr_number || busy.value) return
  busy.value = true
  error.value = ''
  try {
    provider = providerForBinding(target)
    if (!provider.getPullRequest) throw new Error(t('publishing.review_unsupported'))
    const current = await provider.getPullRequest({ owner: target.repo_owner, repo: target.repo_name, number: result.pr_number! })
    if (props.result !== result) return
    review.value = current
    merged.value = review.value.state === 'merged'
    if (merged.value) emit('updated', { ...props.result, merged: true })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('publishing.review_error') }
  finally { busy.value = false }
}

async function updateBranch() {
  const result = props.result
  const target = result.destination
  if (!target || !result.pr_number || !result.commit_sha || busy.value || changed.value) return
  busy.value = true
  error.value = ''
  syncMessage.value = ''
  try {
    provider = providerForBinding(target)
    if (!provider.updatePullRequestBranch) throw new Error(t('publishing.review_unsupported'))
    const outcome = await provider.updatePullRequestBranch({ owner: target.repo_owner, repo: target.repo_name,
      number: result.pr_number, expectedHead: result.commit_sha })
    syncMessage.value = t(outcome.status === 'review_required' ? 'publishing.sync_review_required' : 'publishing.sync_requested')
    if (outcome.review_url) {
      const url = new URL(outcome.review_url)
      if (['https:', 'http:'].includes(url.protocol)) syncReviewUrl.value = url.href
    }
    review.value = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : t('publishing.review_error') }
  finally { busy.value = false }
}

async function merge() {
  const result = props.result
  const target = result.destination
  if (!eligible.value || !target || !result.pr_number || !result.commit_sha || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // Re-resolve credentials for the same saved destination; never trust a PR URL as an API origin.
    provider = providerForBinding(target)
    if (!provider.mergePullRequest) throw new Error(t('publishing.review_unsupported'))
    const outcome = await provider.mergePullRequest({ owner: target.repo_owner, repo: target.repo_name,
      number: result.pr_number, expectedHead: result.commit_sha, method: method.value })
    if (!outcome.merged) throw new Error(t('publishing.merge_unconfirmed'))
    merged.value = true
    emit('updated', { ...result, merged: true })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('publishing.review_error')
    review.value = null
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="result.destination && result.pr_number" class="space-y-2 mt-3">
    <p v-if="merged" class="text-success" role="status">{{ t('publishing.merged') }}</p>
    <template v-else>
      <button type="button" class="btn btn-outline btn-sm" data-testid="check-publication" :disabled="busy" @click="check">{{ t('publishing.check_merge') }}</button>
      <template v-if="review">
        <p class="text-sm" role="status">{{ t(changed ? 'publishing.review_changed' : eligible ? 'publishing.merge_ready' : 'publishing.merge_blocked') }}</p>
        <button v-if="review.state === 'open'" type="button" class="btn btn-outline btn-sm" data-testid="update-contribution"
          :disabled="busy || changed" @click="updateBranch">{{ t('publishing.update_contribution') }}</button>
        <div class="flex flex-wrap items-end gap-2">
          <label>
            <span class="label text-sm">{{ t('publishing.merge_method') }}</span>
            <select v-model="method" class="select select-bordered select-sm" :disabled="busy || !eligible">
              <option value="merge">{{ t('publishing.merge_commit') }}</option>
              <option value="squash">{{ t('publishing.squash_commit') }}</option>
            </select>
          </label>
          <button type="button" class="btn btn-primary btn-sm" data-testid="merge-publication" :disabled="busy || !eligible" @click="merge">{{ t('publishing.merge_reviewed') }}</button>
        </div>
      </template>
    </template>
    <p v-if="syncMessage" class="text-sm" role="status">{{ syncMessage }}</p>
    <a v-if="syncReviewUrl" :href="syncReviewUrl" class="link text-sm" target="_blank" rel="noopener noreferrer">{{ t('publishing.open_sync_review') }}</a>
    <p v-if="error" class="text-error text-sm" role="alert">{{ error }}</p>
  </div>
</template>

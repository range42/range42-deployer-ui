<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit'])
const { t } = useI18n()
const repositoryUrl = ref('')
const provider = ref('github')
const branch = ref('main')
const token = ref('')
const validationError = ref('')

watch(() => props.open, () => {
  repositoryUrl.value = ''
  provider.value = 'github'
  branch.value = 'main'
  token.value = ''
  validationError.value = ''
})

watch(repositoryUrl, (value) => {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === 'github.com') provider.value = 'github'
    else if (host.includes('gitlab')) provider.value = 'gitlab'
    else if (host.includes('gitea')) provider.value = 'gitea'
  } catch { /* Keep the chosen provider while the URL is being entered. */ }
  validationError.value = ''
})

function close() {
  if (!props.busy) emit('close')
}

function submit() {
  if (props.busy) return
  validationError.value = ''
  let url
  let segments
  try {
    url = new URL(repositoryUrl.value.trim())
    segments = url.pathname.replace(/\/+$/, '').slice(1).split('/').map(decodeURIComponent)
    const ownerSegments = segments.slice(0, -1)
    const invalidPath = segments.some((part) => !part || !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        segments.length < 2 || invalidPath ||
        (['github', 'gitea'].includes(provider.value) && ownerSegments.length !== 1) ||
        segments.includes('-')) throw new Error('invalid')
  } catch {
    validationError.value = t('sources.invalid_repo_url')
    return
  }
  const selectedBranch = branch.value.trim()
  const invalidBranchSegment = selectedBranch.split('/').some((part) =>
    !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'),
  )
  if (!selectedBranch || /[\s~^:?*[\\]/.test(selectedBranch) || selectedBranch.includes('..') ||
      selectedBranch.startsWith('-') || selectedBranch === '@' || selectedBranch.includes('@{') || invalidBranchSegment) {
    validationError.value = t('sources.invalid_branch')
    return
  }
  const repo = segments.at(-1).replace(/\.git$/, '')
  if (!repo) {
    validationError.value = t('sources.invalid_repo_url')
    return
  }
  const secret = token.value.trim()
  emit('submit', {
    provider: provider.value,
    base_url: url.origin,
    auth_kind: secret ? 'pat' : 'none',
    ...(secret ? { token_ref: secret } : {}),
    repos: [{ owner: segments.slice(0, -1).join('/'), repo, branch: selectedBranch }],
  })
}
</script>

<template>
  <div v-if="open" class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="add-source-title" @keydown.esc="close">
    <form class="modal-box max-w-xl" @submit.prevent="submit">
      <button type="button" class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4" :disabled="busy" :aria-label="t('common.close')" @click="close">✕</button>
      <h3 id="add-source-title" class="text-xl font-bold pr-10">{{ t('sources.add') }}</h3>
      <p class="text-sm text-base-content/70 mt-2 mb-5">{{ t('sources.add_hint') }}</p>
      <div class="space-y-4">
        <label class="form-control block">
          <span class="label label-text">{{ t('sources.repo_url_label') }}</span>
          <input v-model="repositoryUrl" type="text" class="input input-bordered w-full" placeholder="https://github.com/range42/range42-catalog" :disabled="busy" autocomplete="url" />
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="form-control block">
            <span class="label label-text">{{ t('sources.provider_label') }}</span>
            <select v-model="provider" class="select select-bordered w-full" :disabled="busy">
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="gitea">Gitea</option>
              <option value="generic">{{ t('sources.generic') }}</option>
            </select>
          </label>
          <label class="form-control block">
            <span class="label label-text">{{ t('sources.branch_label') }}</span>
            <input v-model="branch" data-testid="source-branch" type="text" class="input input-bordered w-full" placeholder="main" :disabled="busy" />
          </label>
        </div>
        <label class="form-control block">
          <span class="label label-text">{{ t('sources.token_optional') }}</span>
          <input v-model="token" type="password" class="input input-bordered w-full" :disabled="busy" autocomplete="new-password" aria-describedby="source-token-help" />
        </label>
        <p id="source-token-help" class="text-sm text-base-content/70">{{ t('sources.token_hint') }}</p>
        <p v-if="validationError || error" role="alert" class="text-error text-sm">{{ validationError || error }}</p>
      </div>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
        <button type="button" class="btn btn-primary" :disabled="busy" @click="submit">
          <span v-if="busy" class="loading loading-spinner loading-xs" aria-hidden="true" />
          {{ busy ? t('sources.connecting') : t('sources.connect') }}
        </button>
      </div>
    </form>
    <div class="modal-backdrop" @click="close" />
  </div>
</template>

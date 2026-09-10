<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '@/stores/projectStore'
import { getBackendScope } from '@/services/backendApi'
import { registeredLocalProject } from '@/services/backendProjectRegistration'
import { buildRuntimeRecord, saveRuntimeRecord } from '@/services/runtimeGitRecords'
import { ensureNamespaces } from '@/i18n'

const props = defineProps({ deployment: { type: Object, required: true }, attempts: { type: Array, default: () => [] }, newAttempt: Object })
const { t } = useI18n()
const projects = useProjectStore()
if (!projects.projects.length) projects.loadProjects()
const context = computed(() => JSON.stringify([getBackendScope(), props.deployment.id]))
const project = computed(() => registeredLocalProject(props.deployment.project_id, projects.projects))
const status = ref({})
const tried = new Set()
const bindingKey = value => JSON.stringify(value?.git)
const receiptKey = (scope, path) => JSON.stringify([scope, path])
const rows = computed(() => {
  const attempts = [...props.attempts]
  if (props.newAttempt && !attempts.some(attempt => attempt.id === props.newAttempt.id)) attempts.unshift(props.newAttempt)
  return attempts.filter(attempt => attempt.operation).map(attempt => {
    try {
      const record = buildRuntimeRecord(props.deployment, attempt, getBackendScope())
      const sha = project.value?.runtime_git_receipts?.[receiptKey(getBackendScope(), record.path)]
      const saved = sha && project.value?.files?.[record.path] === record.content
      const requestPath = record.path.replace(/result\.json$/, 'request.json')
      const savedRequest = project.value?.runtime_git_receipts?.[receiptKey(getBackendScope(), requestPath)]
      return { attempt, record, saved: saved ? sha : null, savedRequest }
    } catch (error) { return { attempt, error: error.message } }
  })
})

async function save(row) {
  if (!project.value || row.error || status.value[row.attempt.id]?.saving) return
  const selected = { ...project.value, git: { ...project.value.git } }
  const scope = getBackendScope()
  const current = context.value
  const attempt = JSON.parse(JSON.stringify(row.attempt))
  status.value = { ...status.value, [attempt.id]: { saving: true } }
  try {
    if (Object.hasOwn(selected.files || {}, row.record.path) && selected.files[row.record.path] !== row.record.content) {
      throw new Error(t('runtime.git.localConflict'))
    }
    // Keep a recoverable pending record and check storage quota before Git IO.
    projects.updateProject(selected.id, { files: { ...selected.files, [row.record.path]: row.record.content } })
    const saved = await saveRuntimeRecord(selected, props.deployment, attempt, scope)
    let cacheError = ''
    const latest = projects.getProject(selected.id)
    if (bindingKey(latest) === bindingKey(selected)) {
      try {
        projects.updateProject(selected.id, {
          files: { ...latest.files, [saved.path]: saved.content },
          runtime_git_receipts: { ...latest.runtime_git_receipts, [receiptKey(scope, saved.path)]: saved.commit_sha },
          ...(latest.head_sha === saved.expected_head ? { head_sha: saved.commit_sha } : {}),
        })
      } catch (error) { cacheError = t('runtime.git.cacheError', { message: error.message }) }
    }
    if (context.value === current) status.value = { ...status.value,
      [attempt.id]: { sha: saved.commit_sha, phase: saved.phase, cacheError } }
  } catch (error) {
    if (context.value === current) status.value = { ...status.value, [attempt.id]: { error: error.message } }
  }
}

watch(context, () => { status.value = {}; tried.clear() })
watch([rows, project, status], () => {
  for (const row of rows.value) {
    if (!project.value || !row.record || row.saved || status.value[row.attempt.id]?.saving) continue
    if (props.newAttempt?.id !== row.attempt.id && !row.savedRequest) continue
    const key = JSON.stringify([context.value, row.record.content])
    if (tried.has(key)) continue
    tried.add(key)
    void save(row)
  }
}, { immediate: true })
onMounted(() => ensureNamespaces(['runtime']))
</script>

<template>
  <section v-if="rows.length" class="rounded-xl border border-base-300 p-4 mb-4 space-y-3" data-testid="runtime-git-records">
    <h2 class="font-semibold">{{ t('runtime.git.title') }}</h2>
    <p class="text-sm text-base-content/70">{{ t('runtime.git.description') }}</p>
    <p class="text-sm text-base-content/70">{{ t('runtime.git.policyHint') }}</p>
    <p v-if="!project" class="text-sm border-l-2 border-warning pl-2">{{ t('runtime.git.missingProject') }}</p>
    <RouterLink v-else :to="`/project/${encodeURIComponent(project.id)}`" class="link text-sm">{{ t('runtime.git.openProject', { name: project.name }) }}</RouterLink>
    <ul class="space-y-3">
      <li v-for="row in rows" :key="row.attempt.id" class="text-sm flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0 space-y-1">
          <p class="break-words">{{ t(`runtime.operations.${row.attempt.operation.request?.kind}`) }} · {{ row.attempt.id }}</p>
          <p v-if="row.error || status[row.attempt.id]?.error" role="alert" class="text-error break-words">{{ row.error || status[row.attempt.id].error }}</p>
          <p v-if="status[row.attempt.id]?.cacheError" role="alert" class="break-words">{{ status[row.attempt.id].cacheError }}</p>
          <p v-if="row.saved || (status[row.attempt.id]?.sha && status[row.attempt.id].phase === row.record?.phase)" role="status">
            {{ t(`runtime.git.saved.${row.record.phase}`) }} · <code>{{ (row.saved || status[row.attempt.id].sha).slice(0, 12) }}</code>
          </p>
          <p v-else class="text-base-content/70">{{ t(status[row.attempt.id]?.saving ? 'runtime.git.saving' : 'runtime.git.unsaved') }}</p>
        </div>
        <button v-if="project && !row.saved && !row.error" type="button" class="btn btn-sm btn-outline"
          :data-testid="`runtime-git-save-${row.attempt.id}`" :disabled="status[row.attempt.id]?.saving" @click="save(row)">{{ t('runtime.git.save') }}</button>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { createProjectRepoAdapter } from '@/services/projectRepo'
import { getGitProvider } from '@/services/git'
import {
  commitMigrationToStorage,
  detectLegacyProjects,
  isMigrationComplete,
  runMigration,
} from '@/services/projectRepo/migration.ts'

const emit = defineEmits(['close', 'completed'])

const inventoryStore = useInventoryStore()

// Wizard state
const step = ref(1) // 1=detect, 2=pick source, 3=preview, 4=execute, 5=done
const legacyProjects = ref([])
const selectedSourceId = ref('')
const selectedRepoIdx = ref(0)
const strategy = ref('shared_repo_subdir')
const running = ref(false)
const result = ref(null)
const error = ref('')

const sources = computed(() => inventoryStore.sources || [])

const selectedSource = computed(() =>
  sources.value.find((s) => s.id === selectedSourceId.value),
)

const selectedRepo = computed(() => {
  const src = selectedSource.value
  if (!src || !src.repos || src.repos.length === 0) return null
  return src.repos[selectedRepoIdx.value] || src.repos[0]
})

const canGoToPreview = computed(
  () => !!selectedSource.value && !!selectedRepo.value,
)

onMounted(() => {
  // Only surface if migration hasn't been completed
  if (isMigrationComplete()) {
    emit('close')
    return
  }
  legacyProjects.value = detectLegacyProjects()
  if (legacyProjects.value.length === 0) {
    emit('close')
    return
  }
  // Auto-select first source if there's only one
  if (sources.value.length === 1) {
    selectedSourceId.value = sources.value[0].id
  }
})

function adapterFactory({ sourceId, repo, branch, strategy: strat, projectPath }) {
  const src = inventoryStore.getSource(sourceId)
  if (!src) throw new Error(`Source ${sourceId} not found`)
  const [owner, repoName] = (repo || '').split('/')
  if (!owner || !repoName) throw new Error(`Invalid repo: ${repo}`)
  const provider = getGitProvider(src.provider)
  return createProjectRepoAdapter({
    provider,
    source: {
      id: src.id,
      provider: src.provider,
      base_url: src.base_url,
      auth: src.auth,
      repos: [{ owner, repo: repoName, branch }],
    },
    branchStrategy: strat,
    projectPath,
  })
}

async function onExecute() {
  error.value = ''
  if (!selectedSource.value || !selectedRepo.value) {
    error.value = 'Pick a source and repo first.'
    return
  }
  running.value = true
  try {
    const repoFq = `${selectedRepo.value.owner}/${selectedRepo.value.repo}`
    const branch = selectedRepo.value.branch || 'main'
    const res = await runMigration(
      legacyProjects.value,
      {
        sourceId: selectedSource.value.id,
        repo: repoFq,
        branch,
        strategy: strategy.value,
      },
      adapterFactory,
    )
    result.value = res
    commitMigrationToStorage(res)
    step.value = 5
    emit('completed', res)
  } catch (e) {
    error.value = (e && e.message) || String(e)
  } finally {
    running.value = false
  }
}

function goToPreview() {
  if (canGoToPreview.value) step.value = 3
}
</script>

<template>
  <div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="migration-title">
    <div class="modal-box max-w-2xl">
      <h3 id="migration-title" class="text-lg font-bold mb-4">Migrate local projects to Git</h3>

      <!-- Step 1: detect -->
      <section v-if="step === 1" data-testid="migration-step-detect">
        <p class="text-sm text-base-content/70 mb-4">
          We found {{ legacyProjects.length }} local project(s) stored in your browser
          (<code class="font-mono">range42_projects</code>). Range42 v1 stores projects in Git so
          teams can collaborate. Let's migrate them now.
        </p>
        <div class="modal-action">
          <button class="btn btn-ghost" type="button" @click="emit('close')">Later</button>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="legacyProjects.length === 0"
            @click="step = 2"
          >
            Continue
          </button>
        </div>
      </section>

      <!-- Step 2: pick source -->
      <section v-else-if="step === 2" data-testid="migration-step-source">
        <p class="text-sm text-base-content/70 mb-3">
          Choose a Git source and repository to hold your projects.
        </p>
        <div v-if="sources.length === 0" class="alert alert-warning">
          No Git sources configured yet.
          <a class="link" href="/sources">Add a source</a> first.
        </div>
        <div v-else class="space-y-3">
          <label class="form-control">
            <span class="label-text font-medium">Source</span>
            <select v-model="selectedSourceId" class="select select-bordered">
              <option value="">—</option>
              <option v-for="s in sources" :key="s.id" :value="s.id">
                {{ s.name || s.base_url || s.id }}
              </option>
            </select>
          </label>

          <label v-if="selectedSource" class="form-control">
            <span class="label-text font-medium">Repository</span>
            <select v-model="selectedRepoIdx" class="select select-bordered">
              <option v-for="(r, idx) in selectedSource.repos || []" :key="idx" :value="idx">
                {{ r.owner }}/{{ r.repo }} ({{ r.branch }})
              </option>
            </select>
            <span v-if="!(selectedSource.repos || []).length" class="label-text-alt text-warning mt-1">
              This source has no repositories configured.
            </span>
          </label>

          <label class="form-control">
            <span class="label-text font-medium">Branch strategy</span>
            <select v-model="strategy" class="select select-bordered">
              <option value="shared_repo_subdir">Shared repo — one subdir per project</option>
              <option value="dedicated_repo">Dedicated repo — this repo holds one project</option>
            </select>
          </label>
        </div>
        <div class="modal-action">
          <button class="btn btn-ghost" type="button" @click="step = 1">Back</button>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="!canGoToPreview"
            @click="goToPreview"
          >
            Preview
          </button>
        </div>
      </section>

      <!-- Step 3: preview -->
      <section v-else-if="step === 3" data-testid="migration-step-preview">
        <p class="text-sm text-base-content/70 mb-3">
          Ready to migrate {{ legacyProjects.length }} project(s) to
          <code class="font-mono">{{ selectedRepo.owner }}/{{ selectedRepo.repo }}</code>
          (branch <code class="font-mono">{{ selectedRepo.branch }}</code>).
        </p>
        <ul class="list-disc list-inside text-sm space-y-1 max-h-48 overflow-auto">
          <li v-for="p in legacyProjects" :key="p.id">
            <strong>{{ p.name }}</strong>
            <span class="text-base-content/50"> — {{ p.id }}</span>
          </li>
        </ul>
        <div class="modal-action">
          <button class="btn btn-ghost" type="button" @click="step = 2">Back</button>
          <button class="btn btn-primary" type="button" :disabled="running" @click="onExecute">
            {{ running ? 'Migrating…' : 'Migrate now' }}
          </button>
        </div>
        <div v-if="error" class="alert alert-error mt-3">{{ error }}</div>
      </section>

      <!-- Step 5: done -->
      <section v-else-if="step === 5" data-testid="migration-step-done">
        <p class="text-sm mb-3">
          Migration complete — {{ result.migrated.length }} project(s) written,
          {{ result.failed.length }} failed.
        </p>
        <p class="text-xs text-base-content/60 mb-3">
          Your previous local data is preserved under
          <code class="font-mono">range42_projects_legacy</code> for 30 days. After that it is
          discarded automatically. Use <strong>Open legacy data</strong> in the banner if you need
          to review it.
        </p>
        <ul v-if="result.failed.length" class="list-disc list-inside text-xs text-error mb-3">
          <li v-for="f in result.failed" :key="f.project_id">
            {{ f.name }}: {{ f.error }}
          </li>
        </ul>
        <div class="modal-action">
          <button class="btn btn-primary" type="button" @click="emit('close')">Done</button>
        </div>
      </section>
    </div>
    <div class="modal-backdrop" @click="emit('close')"></div>
  </div>
</template>

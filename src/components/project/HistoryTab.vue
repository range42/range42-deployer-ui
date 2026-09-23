<script setup>
/**
 * HistoryTab — commit list + inline diff viewer for a project overlay.
 *
 * Expects a `provider` implementing `GitProviderV1` (extended in C3.9 with
 * `listCommits`) plus a `{ owner, repo, path, ref }` locator describing
 * the overlay file whose history we want to show.
 *
 * Rows: `sha` (short), `message`, `author`, `date`. Clicking a row fetches
 * the blob at two refs — the clicked commit and its predecessor — and
 * renders them side by side in <DiffViewer>.
 */
import { computed, onMounted, ref, watch } from 'vue'
import DiffViewer from '@/components/ui/DiffViewer.vue'

const props = defineProps({
  provider: { type: Object, required: true },
  locator: {
    type: Object,
    required: true,
    // { owner: string, repo: string, path: string, ref?: string }
  },
})

const commits = ref([])
const loading = ref(false)
const loadError = ref(null)
const selected = ref(null)
const beforeContent = ref('')
const afterContent = ref('')
const diffLoading = ref(false)
const diffError = ref(null)

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    commits.value = await props.provider.listCommits({
      owner: props.locator.owner,
      repo: props.locator.repo,
      path: props.locator.path,
      ref: props.locator.ref,
    })
  } catch (e) {
    loadError.value = e
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
watch(() => props.locator, refresh, { deep: true })

function shortSha(sha) {
  return (sha || '').slice(0, 7)
}

async function selectCommit(commit, index) {
  selected.value = commit
  diffLoading.value = true
  diffError.value = null
  try {
    const prev = commits.value[index + 1] || null
    const after = await props.provider
      .getFile({
        owner: props.locator.owner,
        repo: props.locator.repo,
        path: props.locator.path,
        ref: commit.sha,
      })
      .catch((e) => {
        throw e
      })
    afterContent.value = after?.content ?? ''
    if (prev) {
      const before = await props.provider
        .getFile({
          owner: props.locator.owner,
          repo: props.locator.repo,
          path: props.locator.path,
          ref: prev.sha,
        })
        .catch(() => null)
      beforeContent.value = before?.content ?? ''
    } else {
      beforeContent.value = ''
    }
  } catch (e) {
    diffError.value = e
  } finally {
    diffLoading.value = false
  }
}

const selectedLabel = computed(() =>
  selected.value ? `${shortSha(selected.value.sha)} · ${selected.value.message.split('\n')[0]}` : '',
)
</script>

<template>
  <div class="history-tab flex flex-col h-full min-h-0 gap-2 p-2" data-testid="tab-history-body">
    <div class="flex items-center gap-2">
      <h2 class="font-semibold">
        {{ $t ? $t('historyTab.title') : 'History' }}
      </h2>
      <button class="btn btn-ghost btn-xs" @click="refresh">
        {{ $t ? $t('historyTab.refresh') : 'Refresh' }}
      </button>
    </div>

    <div v-if="loadError" class="alert alert-error text-xs py-1 px-2">
      {{ String(loadError.message || loadError) }}
    </div>

    <div class="overflow-auto border border-base-200 rounded">
      <table class="table table-xs" data-testid="history-commit-table">
        <thead>
          <tr>
            <th>{{ $t ? $t('historyTab.sha') : 'SHA' }}</th>
            <th>{{ $t ? $t('historyTab.message') : 'Message' }}</th>
            <th>{{ $t ? $t('historyTab.author') : 'Author' }}</th>
            <th>{{ $t ? $t('historyTab.date') : 'Date' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(commit, idx) in commits"
            :key="commit.sha"
            class="cursor-pointer hover"
            :class="{ 'bg-base-300': selected?.sha === commit.sha }"
            :data-sha="commit.sha"
            @click="selectCommit(commit, idx)"
          >
            <td class="font-mono text-[11px]">{{ shortSha(commit.sha) }}</td>
            <td class="truncate max-w-[320px]">{{ commit.message.split('\n')[0] }}</td>
            <td>{{ commit.author }}</td>
            <td class="whitespace-nowrap">{{ commit.date }}</td>
          </tr>
          <tr v-if="!loading && commits.length === 0">
            <td colspan="4" class="text-center text-base-content/60 italic">
              {{ $t ? $t('historyTab.empty') : 'No commits found for this path.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="selected" class="flex-1 min-h-0 flex flex-col gap-1">
      <div class="text-xs text-base-content/60 font-mono">
        {{ selectedLabel }}
      </div>
      <div v-if="diffLoading" class="text-xs">…</div>
      <div v-else-if="diffError" class="alert alert-error text-xs py-1 px-2">
        {{ String(diffError.message || diffError) }}
      </div>
      <DiffViewer
        v-else
        class="flex-1 min-h-0"
        :left="beforeContent"
        :right="afterContent"
        :left-label="$t ? $t('historyTab.before') : 'Before'"
        :right-label="$t ? $t('historyTab.after') : 'After'"
      />
    </div>
  </div>
</template>

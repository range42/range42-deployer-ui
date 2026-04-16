<script setup>
/**
 * /deployments/:id — Plan C §C4.4
 *
 * Fetches deployment metadata from the backend, subscribes to the SSE
 * stream, and renders three tabs: Overview · Teams · Logs. The default
 * tab is Teams when team_count > 1 AND state in {deploying|deployed|partial};
 * otherwise Overview. Tab state is mirrored in the URL via ?tab=.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n'
import { useDeploymentStore } from '@/stores/deploymentStore.ts'
import TeamCard from '@/components/ui/TeamCard.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })
const store = useDeploymentStore()

const meta = ref(null) // deployment metadata from the backend (non-live)
const loading = ref(true)
const loadError = ref(null)
const logFilter = ref('')
const teamFilter = ref(null)

const VALID_TABS = ['overview', 'teams', 'logs']
const TEAMS_DEFAULT_STATES = new Set(['deploying', 'deployed', 'partial'])

const live = computed(() => store.deployments[String(route.params.id)] || null)

const teamCount = computed(() => {
  if (live.value?.teams) {
    const n = Object.keys(live.value.teams).length
    if (n > 0) return n
  }
  return meta.value?.team_count ?? 0
})

// Prefer live state only once the SSE has surfaced anything meaningful;
// otherwise fall back to the record from the REST endpoint.
const effectiveState = computed(() => {
  const liveState = live.value?.state
  if (liveState && liveState !== 'unknown') return liveState
  return meta.value?.state || 'unknown'
})

const defaultTab = computed(() => {
  if (teamCount.value > 1 && TEAMS_DEFAULT_STATES.has(effectiveState.value)) return 'teams'
  return 'overview'
})

const activeTab = computed({
  get() {
    const q = String(route.query.tab || '')
    return VALID_TABS.includes(q) ? q : defaultTab.value
  },
  set(tab) {
    if (!VALID_TABS.includes(tab)) return
    router.replace({ query: { ...route.query, tab } })
  },
})

const teamList = computed(() => {
  if (!live.value?.teams) return []
  return Object.entries(live.value.teams).map(([id, slice]) => ({ id, ...slice }))
})

const filteredLogs = computed(() => {
  if (!live.value) return []
  const src = teamFilter.value
    ? (live.value.teams[teamFilter.value]?.latest_logs || [])
    : live.value.logs
  if (!logFilter.value) return src
  const needle = logFilter.value.toLowerCase()
  return src.filter(l => (l.text || '').toLowerCase().includes(needle))
})

const aggregateProgress = computed(() => {
  const state = effectiveState.value
  const map = {
    draft:     0,
    preflight: 10,
    deploying: 50,
    partial:   75,
    deployed:  100,
    failed:    100,
    cancelled: 100,
    torn_down: 100,
  }
  return map[state] ?? 0
})

async function loadMeta() {
  loading.value = true
  try {
    const res = await fetch(`/v1/deployments/${encodeURIComponent(route.params.id)}`, {
      credentials: 'same-origin',
    })
    if (!res.ok) {
      if (res.status === 404) loadError.value = 'not_found'
      else loadError.value = `HTTP ${res.status}`
    } else {
      meta.value = await res.json()
    }
  } catch (err) {
    loadError.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

async function cancelDeployment() {
  try {
    await fetch(`/v1/deployments/${encodeURIComponent(route.params.id)}/cancel`, {
      method: 'POST',
      credentials: 'same-origin',
    })
  } catch {
    // soft fail — UI will surface state via SSE
  }
}

function onOpenTeamLogs(payload) {
  teamFilter.value = payload.teamId
  activeTab.value = 'logs'
}

function clearTeamFilter() {
  teamFilter.value = null
}

onMounted(async () => {
  await ensureNamespaces(['deployment', 'common'])
  await loadMeta()
  // Subscribe regardless — SSE will populate or reconnect.
  store.subscribe(String(route.params.id))
})

watch(() => route.params.id, async (id, prev) => {
  if (!id || id === prev) return
  if (prev) store.unsubscribe(String(prev))
  await loadMeta()
  store.subscribe(String(id))
})

onBeforeUnmount(() => {
  if (route.params.id) store.unsubscribe(String(route.params.id))
})
</script>

<template>
  <section class="max-w-6xl mx-auto p-6">
    <!-- Header -->
    <header class="flex items-start justify-between mb-4 flex-wrap gap-3">
      <div class="min-w-0">
        <div class="text-xs text-base-content/60">
          <router-link :to="{ name: 'deployments' }" class="link">{{ t('deployment.detail.back') }}</router-link>
        </div>
        <h1 class="text-2xl font-semibold mt-1">{{ meta?.codename || route.params.id }}</h1>
        <p class="text-sm text-base-content/70">{{ meta?.scenario_label || meta?.scenario || '—' }}</p>
        <div class="flex items-center gap-2 mt-2 flex-wrap">
          <span class="badge" data-testid="detail-state">{{ effectiveState }}</span>
          <span
            class="badge badge-sm"
            :class="live?.connection === 'open' ? 'badge-success' : live?.connection === 'exhausted' ? 'badge-error' : 'badge-ghost'"
          >
            {{ t('deployment.detail.overview.connection.label') }}:
            {{ t(`deployment.detail.overview.connection.${live?.connection || 'idle'}`) }}
          </span>
          <router-link
            :to="{ name: 'deployment-preflight', params: { id: route.params.id } }"
            class="link text-xs"
          >{{ t('deployment.detail.preflightLink') }}</router-link>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button type="button" class="btn btn-sm btn-ghost" @click="cancelDeployment">
          {{ t('deployment.detail.cancel') }}
        </button>
      </div>
    </header>

    <progress class="progress progress-primary w-full mb-4" :value="aggregateProgress" max="100"></progress>

    <!-- Tabs -->
    <div class="tabs tabs-bordered mb-4" role="tablist">
      <button
        type="button"
        role="tab"
        class="tab"
        :class="activeTab === 'overview' ? 'tab-active' : ''"
        :aria-selected="activeTab === 'overview'"
        data-testid="tab-overview"
        @click="activeTab = 'overview'"
      >{{ t('deployment.detail.tabs.overview') }}</button>
      <button
        type="button"
        role="tab"
        class="tab"
        :class="activeTab === 'teams' ? 'tab-active' : ''"
        :aria-selected="activeTab === 'teams'"
        data-testid="tab-teams"
        @click="activeTab = 'teams'"
      >{{ t('deployment.detail.tabs.teams') }}</button>
      <button
        type="button"
        role="tab"
        class="tab"
        :class="activeTab === 'logs' ? 'tab-active' : ''"
        :aria-selected="activeTab === 'logs'"
        data-testid="tab-logs"
        @click="activeTab = 'logs'"
      >{{ t('deployment.detail.tabs.logs') }}</button>
    </div>

    <!-- Overview -->
    <section v-show="activeTab === 'overview'" data-testid="panel-overview" role="tabpanel">
      <div class="card card-compact bg-base-100 border border-base-300 mb-4">
        <div class="card-body p-4">
          <h2 class="card-title text-sm">{{ t('deployment.detail.overview.stateChainHeading') }}</h2>
          <ol v-if="meta?.attempts?.length" class="list-decimal pl-5 space-y-1 text-sm">
            <li v-for="(att, idx) in meta.attempts" :key="idx">
              <span class="font-mono text-xs">{{ att.attempt_id || `#${idx + 1}` }}</span>
              <span class="ml-2 text-base-content/70">{{ att.state }}</span>
              <span v-if="att.started_at" class="ml-2 text-xs text-base-content/50">{{ att.started_at }}</span>
            </li>
          </ol>
          <p v-else class="text-sm italic text-base-content/60">{{ t('deployment.detail.overview.noAttempts') }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="card card-compact bg-base-100 border border-base-300">
          <div class="card-body p-3">
            <h3 class="text-xs uppercase tracking-wide text-base-content/60">
              {{ t('deployment.detail.overview.phaseHeading') }}
            </h3>
            <p class="font-mono text-sm mt-1">{{ live?.phase || '—' }}</p>
          </div>
        </div>
        <div class="card card-compact bg-base-100 border border-base-300">
          <div class="card-body p-3">
            <h3 class="text-xs uppercase tracking-wide text-base-content/60">
              {{ t('deployment.detail.overview.lastHeartbeat') }}
            </h3>
            <p class="font-mono text-sm mt-1">{{ live?.last_heartbeat_at || '—' }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Teams -->
    <section v-show="activeTab === 'teams'" data-testid="panel-teams" role="tabpanel">
      <h2 class="text-lg font-semibold mb-3">{{ t('deployment.detail.teams.heading') }}</h2>
      <div
        v-if="teamList.length === 0"
        class="text-sm text-base-content/60 italic"
      >{{ t('deployment.detail.teams.empty') }}</div>
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="teams-grid">
        <TeamCard
          v-for="team in teamList"
          :key="team.id"
          :team="team"
          @open-logs="onOpenTeamLogs"
        />
      </div>
    </section>

    <!-- Logs -->
    <section v-show="activeTab === 'logs'" data-testid="panel-logs" role="tabpanel">
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <input
          v-model="logFilter"
          type="text"
          :placeholder="t('deployment.detail.logs.filterPlaceholder')"
          class="input input-bordered input-sm flex-1 min-w-0"
        />
        <a
          class="btn btn-sm btn-ghost"
          :href="`/v1/deployments/${encodeURIComponent(String(route.params.id))}/events?format=raw`"
          download="events.jsonl"
        >{{ t('deployment.detail.logs.download') }}</a>
      </div>
      <div v-if="teamFilter" class="text-xs text-base-content/70 mb-2 flex items-center gap-2">
        <span>{{ t('deployment.detail.logs.teamFilter', { id: teamFilter }) }}</span>
        <button type="button" class="btn btn-xs btn-ghost" @click="clearTeamFilter">
          {{ t('deployment.detail.logs.clearTeamFilter') }}
        </button>
      </div>
      <div
        v-if="filteredLogs.length === 0"
        class="text-sm text-base-content/60 italic"
      >{{ t('deployment.detail.logs.empty') }}</div>
      <ul
        v-else
        class="font-mono text-xs bg-base-200/60 p-2 rounded max-h-[60vh] overflow-y-auto"
        data-testid="logs-list"
      >
        <li
          v-for="(line, i) in filteredLogs"
          :key="i"
          :class="line.stream === 'stderr' ? 'text-error' : ''"
        >{{ line.ts }} <span class="opacity-70">{{ line.team_id || '-' }}</span> {{ line.text }}</li>
      </ul>
    </section>

    <div v-if="loadError === 'not_found'" class="alert alert-error mt-6">
      {{ t('deployment.detail.notFound') }}
    </div>
  </section>
</template>

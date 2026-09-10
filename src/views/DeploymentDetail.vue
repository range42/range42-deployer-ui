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
import TeardownConfirmModal from '@/components/TeardownConfirmModal.vue'
import ResetTeamModal from '@/components/ResetTeamModal.vue'
import SnapshotCreateModal from '@/components/SnapshotCreateModal.vue'
import RollbackModal from '@/components/RollbackModal.vue'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import PreflightReport from '@/components/ui/PreflightReport.vue'
import { useToast } from '@/composables/useToast'
import { latestSavedProjectRevision } from '@/services/backendProjectRegistration'

const route = useRoute()
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })
const store = useDeploymentStore()
const backend = useBackendApiStore()
let contextVersion = 0

const attempts = ref([])
const attemptsError = ref(null)
const meta = ref(null) // deployment metadata from the backend (non-live)
const loading = ref(true)
const loadError = ref(null)
const logFilter = ref('')
const teamFilter = ref(null)
const showTeardown = ref(false)
const actionError = ref(null)
const preflight = ref(null)
const checkingPreflight = ref(false)
const starting = ref(false)
const warningsAck = ref(false)
const canPrepare = computed(() => meta.value && !loading.value && !loadError.value
  && ['pending', 'preflight_review', 'failed', 'cancelled'].includes(effectiveState.value))
const hasWarnings = computed(() => preflight.value?.result === 'warn'
  || preflight.value?.checks?.some(check => check.result === 'warn'))
const canStart = computed(() => canPrepare.value && !checkingPreflight.value && !starting.value
  && preflight.value && ['pass', 'warn'].includes(preflight.value.result)
  && !preflight.value.checks?.some(check => check.result === 'block')
  && (!hasWarnings.value || warningsAck.value))

const VALID_TABS = ['overview', 'teams', 'logs']
const TEAMS_DEFAULT_STATES = new Set(['deploying', 'deployed', 'succeeded', 'partial'])

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

const supportsLegacyActions = computed(() => !(meta.value?.project_sha && meta.value?.scenario_label !== '_universal'))
const maintenanceScope = ref('configure')
const maintenanceSha = ref('')
const maintenanceConfirm = ref('')
const maintenanceRecord = ref(null)
const maintenanceSnapshot = ref(null)
const maintenanceWarningsAck = ref(false)
const maintenanceBusy = ref(false)
let maintenanceVersion = 0
const canMaintain = computed(() => !supportsLegacyActions.value && !loading.value && !loadError.value
  && ['succeeded', 'deployed', 'failed', 'cancelled', 'partial', 'preflight_review'].includes(effectiveState.value))
const maintenanceRequest = computed(() => maintenanceScope.value === 'configure'
  ? { scope: 'configure', project_sha: maintenanceSha.value.trim() } : { scope: 'teardown' })
const maintenanceWarnings = computed(() => maintenanceRecord.value?.result === 'warn'
  || maintenanceRecord.value?.checks?.some(check => check.result === 'warn'))
const canRunMaintenance = computed(() => canMaintain.value && !maintenanceBusy.value
  && maintenanceRecord.value && ['pass', 'warn'].includes(maintenanceRecord.value.result)
  && !maintenanceRecord.value.checks?.some(check => check.result === 'block')
  && JSON.stringify(maintenanceSnapshot.value) === JSON.stringify(maintenanceRequest.value)
  && (!maintenanceWarnings.value || maintenanceWarningsAck.value)
  && (maintenanceScope.value !== 'teardown' || (meta.value?.codename && maintenanceConfirm.value === meta.value.codename)))
watch([maintenanceScope, maintenanceSha], () => {
  maintenanceVersion += 1
  maintenanceRecord.value = null
  maintenanceSnapshot.value = null
  maintenanceWarningsAck.value = false
  maintenanceBusy.value = false
})
const canCancel = computed(() => ['pending', 'preflight_running', 'preflight_review', 'deploying', 'running_attempt'].includes(effectiveState.value))

const defaultTab = computed(() => {
  if (teamCount.value > 1 && TEAMS_DEFAULT_STATES.has(effectiveState.value)) return 'teams'
  return 'overview'
})

// Plan C §C4.9 — per-team reset + queued-behind-in-flight semantics.
const showResetModal = ref(false)
const resetTeamId = ref(null)
const queuedResets = ref(new Set())
const { showToast } = useToast()

const IN_FLIGHT_STATES = new Set(['deploying', 'running_attempt'])
const inFlight = computed(() => IN_FLIGHT_STATES.has(effectiveState.value))

function onOpenReset(payload) {
  resetTeamId.value = payload?.teamId || null
  if (!resetTeamId.value) return
  showResetModal.value = true
}

function onResetDone() {
  if (resetTeamId.value) {
    queuedResets.value.delete(resetTeamId.value)
    queuedResets.value = new Set(queuedResets.value)
  }
  resetTeamId.value = null
}

function onResetQueued(payload) {
  const id = payload?.teamId
  if (!id) return
  queuedResets.value.add(id)
  queuedResets.value = new Set(queuedResets.value)
  showToast(t('deployment.reset.queuedToast', { id }), 'info')
  resetTeamId.value = null
}

// When the in-flight attempt transitions to failed or cancelled, prompt the
// user to run queued resets.
watch(effectiveState, (state, prev) => {
  if (!prev) return
  const wasInFlight = IN_FLIGHT_STATES.has(prev)
  const becameTerminal = state === 'failed' || state === 'cancelled'
  if (wasInFlight && becameTerminal && queuedResets.value.size > 0) {
    for (const id of queuedResets.value) {
      showToast(t('deployment.reset.runNowToast', { id }), 'warning', 10000)
    }
  }
})

function teamWithQueueStatus(team) {
  if (queuedResets.value.has(team.id)) {
    return { ...team, queued_reset: true }
  }
  return team
}

// Plan C §C4.10 — Snapshots + Rollback
const showSnapshotModal = ref(false)
const showRollbackModal = ref(false)
const snapshotTeamId = ref(null)
// Map teamId → snapshots[]; fetched lazily when the rollback modal opens.
const teamSnapshots = ref({})

function onOpenSnapshot(payload) {
  snapshotTeamId.value = payload?.teamId || null
  if (!snapshotTeamId.value) return
  showSnapshotModal.value = true
}

async function fetchTeamSnapshots(id, teamId) {
  const version = contextVersion
  try {
    const url = `/v1/deployments/${encodeURIComponent(id)}/snapshots?team_id=${encodeURIComponent(teamId)}`
    const body = await backendRequest(url)
    if (version !== contextVersion) return
    const list = Array.isArray(body) ? body : (body?.items || body?.snapshots || [])
    teamSnapshots.value = { ...teamSnapshots.value, [teamId]: list }
  } catch (error) {
    if (version === contextVersion) actionError.value = error.message
  }
}

async function onOpenRollback(payload) {
  const id = payload?.teamId
  if (!id) return
  snapshotTeamId.value = id
  const version = contextVersion
  await fetchTeamSnapshots(String(route.params.id), id)
  if (version === contextVersion) showRollbackModal.value = true
}

function onSnapshotCreated() {
  if (snapshotTeamId.value) {
    // Force refresh next time the rollback modal opens.
    const copy = { ...teamSnapshots.value }
    delete copy[snapshotTeamId.value]
    teamSnapshots.value = copy
  }
  showSnapshotModal.value = false
}

function onRolledBack(payload) {
  showRollbackModal.value = false
  if (payload?.partial) {
    showToast(t('deployment.rollback.partial'), 'warning')
  }
}

const rollbackSnapshots = computed(() => {
  if (!snapshotTeamId.value) return []
  return teamSnapshots.value[snapshotTeamId.value] || []
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
    pending:   0,
    preflight_running: 10,
    preflight_review: 20,
    succeeded: 100,
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
  const version = contextVersion
  loading.value = true
  loadError.value = null
  try {
    const record = await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}`)
    if (version === contextVersion) {
      meta.value = record
      if (!maintenanceSha.value) maintenanceSha.value = latestSavedProjectRevision(record.project_id) || record.project_sha || ''
      await loadAttempts()
    }
  } catch (error) {
    if (version === contextVersion) {
      loadError.value = error.status === 404 ? 'not_found' : error.message
    }
  } finally {
    if (version === contextVersion) loading.value = false
  }
}

async function loadAttempts() {
  const version = contextVersion
  try {
    const page = await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}/attempts`)
    if (version === contextVersion) {
      attempts.value = page.items || []
      attemptsError.value = null
    }
  } catch (error) {
    if (version === contextVersion) attemptsError.value = error.message
  }
}

watch(() => live.value?.state, (state, previous) => {
  if (state !== previous && ['succeeded', 'failed', 'cancelled', 'partial'].includes(state)) {
    void loadAttempts()
  }
})

async function cancelDeployment() {
  const version = contextVersion
  actionError.value = null
  try {
    await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}/cancel`, { method: 'POST' })
    if (version === contextVersion) await loadMeta()
  } catch (error) {
    if (version === contextVersion) actionError.value = error.message
  }
}

async function runPreflight() {
  if (!canPrepare.value || checkingPreflight.value || starting.value) return
  const version = contextVersion
  checkingPreflight.value = true
  preflight.value = null
  warningsAck.value = false
  actionError.value = null
  try {
    const record = await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}/preflight`, { method: 'POST' })
    if (version === contextVersion) preflight.value = record
  } catch (error) {
    if (version === contextVersion) actionError.value = error.message
  } finally {
    if (version === contextVersion) checkingPreflight.value = false
  }
}

async function startDeployment() {
  if (!canStart.value) return
  const version = contextVersion
  starting.value = true
  actionError.value = null
  try {
    const attempt = await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}/attempts`, {
      method: 'POST', body: JSON.stringify({ scope: 'full' }),
    })
    if (version !== contextVersion) return
    preflight.value = null
    if (attempt.state === 'failed') {
      actionError.value = t('deployment.detail.startFailed', { reason: attempt.sub_reason || 'ATTEMPT_START_FAILED' })
    }
    await loadMeta()
  } catch (error) {
    if (version === contextVersion) actionError.value = error.message
  } finally {
    if (version === contextVersion) starting.value = false
  }
}

async function checkMaintenance() {
  if (!canMaintain.value || maintenanceBusy.value) return
  actionError.value = null
  const snapshot = { ...maintenanceRequest.value }
  if (snapshot.scope === 'configure' && !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(snapshot.project_sha)) {
    actionError.value = t('deployment.maintenance.invalidSha')
    return
  }
  const context = contextVersion
  const version = ++maintenanceVersion
  maintenanceBusy.value = true
  maintenanceRecord.value = null
  maintenanceWarningsAck.value = false
  try {
    const record = await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}/preflight`, {
      method: 'POST', body: JSON.stringify(snapshot),
    })
    if (context !== contextVersion || version !== maintenanceVersion) return
    maintenanceSnapshot.value = snapshot
    maintenanceRecord.value = record
  } catch (error) {
    if (context === contextVersion && version === maintenanceVersion) actionError.value = error.message
  } finally {
    if (context === contextVersion && version === maintenanceVersion) maintenanceBusy.value = false
  }
}

async function runMaintenance() {
  if (!canRunMaintenance.value) return
  const context = contextVersion
  const snapshot = { ...maintenanceSnapshot.value }
  maintenanceBusy.value = true
  actionError.value = null
  try {
    const attempt = await backendRequest(`/v1/deployments/${encodeURIComponent(route.params.id)}/attempts`, {
      method: 'POST', body: JSON.stringify(snapshot),
    })
    if (context !== contextVersion) return
    maintenanceRecord.value = null
    maintenanceConfirm.value = ''
    if (attempt.state === 'failed') actionError.value = t('deployment.detail.startFailed', { reason: attempt.sub_reason || 'ATTEMPT_START_FAILED' })
    await loadMeta()
  } catch (error) {
    if (context === contextVersion) actionError.value = error.message
  } finally {
    if (context === contextVersion) maintenanceBusy.value = false
  }
}

function onOpenTeamLogs(payload) {
  teamFilter.value = payload.teamId
  activeTab.value = 'logs'
}

function clearTeamFilter() {
  teamFilter.value = null
}

onMounted(() => { ensureNamespaces(['deployment', 'common']) })

watch([() => route.params.id, getBackendScope, () => backend.token], async ([id], previous) => {
  const version = ++contextVersion
  if (previous?.[0]) store.unsubscribe(String(previous[0]))
  meta.value = null
  attempts.value = []
  attemptsError.value = null
  preflight.value = null
  checkingPreflight.value = false
  starting.value = false
  actionError.value = null
  warningsAck.value = false
  maintenanceVersion += 1
  maintenanceScope.value = 'configure'
  maintenanceSha.value = ''
  maintenanceConfirm.value = ''
  maintenanceRecord.value = null
  maintenanceSnapshot.value = null
  maintenanceBusy.value = false
  maintenanceWarningsAck.value = false
  teamSnapshots.value = {}
  queuedResets.value = new Set()
  showResetModal.value = false
  showSnapshotModal.value = false
  showRollbackModal.value = false
  showTeardown.value = false
  if (!id) return
  await loadMeta()
  if (version === contextVersion && !loadError.value) store.subscribe(String(id))
}, { immediate: true, flush: 'sync' })

onBeforeUnmount(() => {
  contextVersion += 1
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
        <button v-if="canCancel" type="button" class="btn btn-sm btn-ghost" @click="cancelDeployment">
          {{ t('deployment.detail.cancel') }}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-error btn-outline"
          v-if="supportsLegacyActions && meta"
          data-testid="detail-teardown-open"
          @click="showTeardown = true"
        >
          {{ t('deployment.detail.teardown') }}
        </button>
      </div>
    </header>

    <!-- Plan C §C4.8 — Teardown confirm-phrase modal -->
    <TeardownConfirmModal
      v-if="showTeardown && supportsLegacyActions"
      :visible="showTeardown"
      :deployment-id="String(route.params.id)"
      :codename="meta?.codename || String(route.params.id)"
      @close="showTeardown = false"
    />

    <!-- Plan C §C4.9 — Per-team reset modal -->
    <ResetTeamModal
      v-if="showResetModal && resetTeamId && supportsLegacyActions"
      :visible="showResetModal"
      :deployment-id="String(route.params.id)"
      :team-id="resetTeamId"
      :in-flight="inFlight"
      @close="showResetModal = false"
      @reset="onResetDone"
      @queued="onResetQueued"
    />

    <!-- Plan C §C4.10 — Snapshot + Rollback -->
    <SnapshotCreateModal
      v-if="showSnapshotModal && snapshotTeamId && supportsLegacyActions"
      :visible="showSnapshotModal"
      :deployment-id="String(route.params.id)"
      :team-id="snapshotTeamId"
      @close="showSnapshotModal = false"
      @created="onSnapshotCreated"
    />
    <RollbackModal
      v-if="showRollbackModal && snapshotTeamId && supportsLegacyActions"
      :visible="showRollbackModal"
      :deployment-id="String(route.params.id)"
      :team-id="snapshotTeamId"
      :snapshots="rollbackSnapshots"
      @close="showRollbackModal = false"
      @rolled-back="onRolledBack"
    />

    <p v-if="actionError" role="alert" class="alert alert-error mb-4">{{ actionError }}</p>
    <p v-if="loadError && loadError !== 'not_found'" role="alert" class="alert alert-error mb-4">{{ loadError }}</p>
    <div v-if="canPrepare" class="rounded border border-base-300 p-4 mb-4 space-y-3">
      <p class="text-sm">{{ t('deployment.detail.prepareDescription') }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-outline" data-testid="deployment-run-preflight"
          :disabled="checkingPreflight || starting" @click="runPreflight">
          {{ checkingPreflight ? t('deployment.deploy.preflight.running') : t('deployment.detail.runPreflight') }}
        </button>
        <button type="button" class="btn btn-sm btn-primary" data-testid="deployment-start"
          :disabled="!canStart" @click="startDeployment">{{ t('deployment.detail.start') }}</button>
      </div>
      <PreflightReport v-if="preflight" :record="preflight" />
      <label v-if="hasWarnings" class="flex items-center gap-2 text-sm">
        <input v-model="warningsAck" type="checkbox" class="checkbox checkbox-sm" data-testid="deployment-warnings-ack" />
        {{ t('deployment.deploy.preflight.acknowledge') }}
      </label>
    </div>

    <progress class="progress progress-primary w-full mb-4" :value="aggregateProgress" max="100"></progress>

    <section v-if="canMaintain" class="rounded border border-base-300 p-4 mb-4 space-y-3" aria-labelledby="maintenance-heading">
      <h2 id="maintenance-heading" class="font-semibold">{{ t('deployment.maintenance.title') }}</h2>
      <p class="text-sm text-base-content/70">{{ t('deployment.maintenance.description') }}</p>
      <label class="form-control gap-1"><span>{{ t('deployment.maintenance.action') }}</span>
        <select v-model="maintenanceScope" class="select select-bordered w-full" data-testid="maintenance-scope" :disabled="maintenanceBusy">
          <option value="configure">{{ t('deployment.maintenance.configure') }}</option>
          <option value="teardown">{{ t('deployment.maintenance.teardown') }}</option>
        </select>
      </label>
      <label v-if="maintenanceScope === 'configure'" class="form-control gap-1"><span>{{ t('deployment.maintenance.revision') }}</span>
        <input v-model="maintenanceSha" class="input input-bordered font-mono w-full" data-testid="configure-project-sha" :disabled="maintenanceBusy" spellcheck="false" />
        <span class="text-xs text-base-content/70">{{ t('deployment.maintenance.revisionHint') }}</span>
      </label>
      <label v-else class="form-control gap-1"><span>{{ t('deployment.maintenance.confirm', { codename: meta.codename }) }}</span>
        <input v-model="maintenanceConfirm" class="input input-bordered w-full" data-testid="maintenance-confirm" :disabled="maintenanceBusy" autocomplete="off" />
      </label>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-outline btn-sm" data-testid="maintenance-preflight" :disabled="maintenanceBusy" @click="checkMaintenance">{{ t('deployment.maintenance.preflight') }}</button>
        <button type="button" class="btn btn-sm" :class="maintenanceScope === 'teardown' ? 'btn-error' : 'btn-primary'" data-testid="maintenance-start" :disabled="!canRunMaintenance" @click="runMaintenance">{{ t('deployment.maintenance.start') }}</button>
      </div>
      <PreflightReport v-if="maintenanceRecord" :record="maintenanceRecord" />
      <label v-if="maintenanceWarnings" class="flex items-center gap-2 text-sm"><input v-model="maintenanceWarningsAck" type="checkbox" class="checkbox checkbox-sm" />{{ t('deployment.deploy.preflight.acknowledge') }}</label>
    </section>

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
          <ol v-if="attempts.length" class="list-decimal pl-5 space-y-1 text-sm">
            <li v-for="(att, idx) in attempts" :key="idx">
              <span class="font-mono text-xs">{{ att.id || att.attempt_id || `#${idx + 1}` }}</span>
              <span class="ml-2 text-base-content/70">{{ att.state }}</span>
              <span v-if="att.scope" class="ml-2 text-xs">{{ att.scope }}</span>
              <code v-if="att.project_sha" class="ml-2 text-xs break-all">{{ att.project_sha }}</code>
              <span v-if="att.started_at" class="ml-2 text-xs text-base-content/50">{{ att.started_at }}</span>
            </li>
          </ol>
          <p v-else-if="attemptsError" class="text-sm text-error">{{ attemptsError }}</p>
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
          :actions-enabled="supportsLegacyActions"
          v-for="team in teamList"
          :key="team.id"
          :team="teamWithQueueStatus(team)"
          @open-logs="onOpenTeamLogs"
          @reset="onOpenReset"
          @snapshot="onOpenSnapshot"
          @rollback="onOpenRollback"
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

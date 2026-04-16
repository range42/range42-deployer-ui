<script setup>
/**
 * /deployments — Plan C §C4.3
 *
 * Two sections: Active (non-terminal state) + Past (grouped by project).
 * Row: codename, scenario, state badge, started, attempts count,
 *      open → /deployments/:id.
 * Filter chips: failed only, in-progress only.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n'
import EmptyState from '@/components/ui/EmptyState.vue'

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()

// Terminal state labels (spec §12 canonicalisation): deployed | failed | cancelled | torn_down.
const TERMINAL_STATES = new Set(['deployed', 'failed', 'cancelled', 'torn_down'])

const deployments = ref([])
const loadError = ref(null)
const loading = ref(true)

const filter = ref('all') // all | in_progress | failed

onMounted(async () => {
  await ensureNamespaces(['deployment', 'common'])
  try {
    const res = await fetch('/v1/deployments', { credentials: 'same-origin' })
    if (!res.ok) {
      loadError.value = `HTTP ${res.status}`
      loading.value = false
      return
    }
    const body = await res.json()
    deployments.value = Array.isArray(body) ? body : (body?.deployments || [])
  } catch (err) {
    // Backend not running or CORS — show empty state with subtle notice.
    loadError.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
})

function isTerminal(state) {
  return TERMINAL_STATES.has(state)
}

function stateBadgeClass(state) {
  switch (state) {
    case 'deployed':  return 'badge-success'
    case 'failed':    return 'badge-error'
    case 'cancelled': return 'badge-ghost'
    case 'torn_down': return 'badge-ghost'
    case 'deploying':
    case 'preflight': return 'badge-info'
    case 'partial':   return 'badge-warning'
    default:          return 'badge-neutral'
  }
}

const filtered = computed(() => {
  const items = deployments.value || []
  if (filter.value === 'failed')      return items.filter(d => d.state === 'failed')
  if (filter.value === 'in_progress') return items.filter(d => !isTerminal(d.state))
  return items
})

const active = computed(() => filtered.value.filter(d => !isTerminal(d.state)))
const past = computed(() => filtered.value.filter(d => isTerminal(d.state)))

// Group past by project_id (or "__no_project__" bucket) preserving insertion order.
const pastByProject = computed(() => {
  const groups = new Map()
  for (const d of past.value) {
    const key = d.project_id || '__no_project__'
    const projectName = d.project_name || null
    if (!groups.has(key)) groups.set(key, { key, projectName, items: [] })
    groups.get(key).items.push(d)
  }
  return Array.from(groups.values())
})

function openDeployment(id) {
  router.push({ name: 'deployment-detail', params: { id } })
}
</script>

<template>
  <section class="max-w-5xl mx-auto p-6">
    <header class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('deployment.list.title') }}</h1>
        <p class="text-sm text-base-content/70 mt-1">{{ t('deployment.list.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2" role="group" aria-label="filters">
        <button
          type="button"
          class="btn btn-sm"
          :class="filter === 'in_progress' ? 'btn-primary' : 'btn-ghost'"
          @click="filter = filter === 'in_progress' ? 'all' : 'in_progress'"
        >
          {{ t('deployment.list.filters.inProgressOnly') }}
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="filter === 'failed' ? 'btn-primary' : 'btn-ghost'"
          @click="filter = filter === 'failed' ? 'all' : 'failed'"
        >
          {{ t('deployment.list.filters.failedOnly') }}
        </button>
        <button
          v-if="filter !== 'all'"
          type="button"
          class="btn btn-sm btn-ghost"
          @click="filter = 'all'"
        >
          {{ t('deployment.list.filters.clear') }}
        </button>
      </div>
    </header>

    <div v-if="loadError && deployments.length === 0" class="alert alert-warning text-sm mb-4">
      {{ loadError }}
    </div>

    <div v-if="!loading && deployments.length === 0 && !loadError">
      <EmptyState :title="t('deployment.list.emptyAll')" icon="🚀" />
    </div>

    <div v-if="deployments.length > 0" class="space-y-8" data-testid="deployments-root">
      <!-- Active -->
      <section data-testid="deployments-active">
        <h2 class="text-lg font-semibold mb-3">{{ t('deployment.list.activeHeading') }}</h2>
        <div v-if="active.length === 0" class="text-sm text-base-content/60 italic">
          {{ t('deployment.list.noActive') }}
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="d in active"
            :key="d.id"
            class="card card-compact bg-base-100 border border-base-300 hover:shadow-md transition"
          >
            <button
              type="button"
              class="card-body p-3 grid grid-cols-12 items-center gap-2 text-left w-full"
              data-testid="deployment-row"
              @click="openDeployment(d.id)"
            >
              <div class="col-span-4 min-w-0">
                <div class="font-semibold truncate">{{ d.codename || d.id }}</div>
                <div class="text-xs text-base-content/60 truncate">{{ d.scenario_label || d.scenario || '—' }}</div>
              </div>
              <div class="col-span-2">
                <span class="badge badge-sm" :class="stateBadgeClass(d.state)">{{ d.state }}</span>
              </div>
              <div class="col-span-3 text-xs text-base-content/70 truncate">{{ d.started_at || '—' }}</div>
              <div class="col-span-2 text-xs">
                {{ t('deployment.list.row.attemptCount', { n: d.attempts_count ?? 0 }, d.attempts_count ?? 0) }}
              </div>
              <div class="col-span-1 text-right">
                <RouterLink
                  :to="{ name: 'deployment-detail', params: { id: d.id } }"
                  class="btn btn-xs btn-ghost"
                  @click.stop
                >{{ t('deployment.list.row.open') }}</RouterLink>
              </div>
            </button>
          </li>
        </ul>
      </section>

      <!-- Past grouped by project -->
      <section data-testid="deployments-past">
        <h2 class="text-lg font-semibold mb-3">{{ t('deployment.list.pastHeading') }}</h2>
        <div v-if="past.length === 0" class="text-sm text-base-content/60 italic">
          {{ t('deployment.list.noPast') }}
        </div>
        <div v-else class="space-y-6">
          <div
            v-for="group in pastByProject"
            :key="group.key"
            class="space-y-2"
            data-testid="past-group"
          >
            <h3 class="text-sm font-medium text-base-content/70">
              {{ group.projectName || t('deployment.list.row.noProject') }}
            </h3>
            <ul class="space-y-2">
              <li
                v-for="d in group.items"
                :key="d.id"
                class="card card-compact bg-base-100 border border-base-300 hover:shadow-md transition"
              >
                <button
                  type="button"
                  class="card-body p-3 grid grid-cols-12 items-center gap-2 text-left w-full"
                  data-testid="deployment-row"
                  @click="openDeployment(d.id)"
                >
                  <div class="col-span-4 min-w-0">
                    <div class="font-semibold truncate">{{ d.codename || d.id }}</div>
                    <div class="text-xs text-base-content/60 truncate">{{ d.scenario_label || d.scenario || '—' }}</div>
                  </div>
                  <div class="col-span-2">
                    <span class="badge badge-sm" :class="stateBadgeClass(d.state)">{{ d.state }}</span>
                  </div>
                  <div class="col-span-3 text-xs text-base-content/70 truncate">{{ d.started_at || '—' }}</div>
                  <div class="col-span-2 text-xs">
                    {{ t('deployment.list.row.attemptCount', { n: d.attempts_count ?? 0 }, d.attempts_count ?? 0) }}
                  </div>
                  <div class="col-span-1 text-right">
                    <RouterLink
                      :to="{ name: 'deployment-detail', params: { id: d.id } }"
                      class="btn btn-xs btn-ghost"
                      @click.stop
                    >{{ t('deployment.list.row.open') }}</RouterLink>
                  </div>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

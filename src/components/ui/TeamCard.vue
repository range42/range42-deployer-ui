<script setup>
/**
 * <TeamCard> — Plan C §C4.2
 *
 * Renders one team tile inside the Deployment detail Teams grid.
 * Props:
 *   team: {
 *     id: string
 *     status: 'pending'|'deploying'|'deployed'|'failed'|'partial'|'unknown'
 *     latest_logs: { ts, stream, text }[]   // last N, we show 3
 *     snapshots: { id, label, created_at }[]
 *     ssh_command?: string
 *     terminal_url?: string
 *     queued_reset?: boolean
 *   }
 *
 * Emits:
 *   - open-logs  → parent filters logs by team
 *   - reset      → queued-behind-in-flight (C4.9 wires backend)
 *   - snapshot   → create snapshot
 *   - rollback   → rollback modal
 *   - copy-ssh   → copied SSH command to clipboard
 *   - open-terminal
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  actionsEnabled: { type: Boolean, default: true },
  team: {
    type: Object,
    required: true,
  },
})
const emit = defineEmits(['open-logs', 'reset', 'snapshot', 'rollback', 'copy-ssh', 'open-terminal'])

const { t } = useI18n({ useScope: 'global' })
const menuOpen = ref(false)

const statusBadge = computed(() => {
  const s = props.team.status || 'unknown'
  const map = {
    pending:   { cls: 'badge-ghost',   label: t('deployment.team.status.pending') },
    deploying: { cls: 'badge-info',    label: t('deployment.team.status.deploying') },
    deployed:  { cls: 'badge-success', label: t('deployment.team.status.deployed') },
    failed:    { cls: 'badge-error',   label: t('deployment.team.status.failed') },
    partial:   { cls: 'badge-warning', label: t('deployment.team.status.partial') },
    unknown:   { cls: 'badge-ghost',   label: t('deployment.team.status.unknown') },
  }
  return map[s] || map.unknown
})

const latestLines = computed(() => (props.team.latest_logs || []).slice(-3))

function onOpenLogs() {
  emit('open-logs', { teamId: props.team.id })
}
function onReset() { emit('reset', { teamId: props.team.id }); menuOpen.value = false }
function onSnapshot() { emit('snapshot', { teamId: props.team.id }); menuOpen.value = false }
function onRollback() { emit('rollback', { teamId: props.team.id }); menuOpen.value = false }
async function onCopySsh() {
  if (props.team.ssh_command && typeof navigator !== 'undefined' && navigator.clipboard) {
    try { await navigator.clipboard.writeText(props.team.ssh_command) } catch { /* ignore */ }
  }
  emit('copy-ssh', { teamId: props.team.id })
  menuOpen.value = false
}
function onOpenTerminal() { emit('open-terminal', { teamId: props.team.id }); menuOpen.value = false }
</script>

<template>
  <article
    class="team-card card card-compact bg-base-100 border border-base-300 hover:shadow-md transition-shadow"
    :aria-label="t('deployment.team.ariaLabel', { id: team.id })"
    data-testid="team-card"
  >
    <div class="card-body p-3 gap-2">
      <header class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="font-semibold text-sm truncate">{{ team.id }}</h3>
          <div class="flex items-center gap-1 mt-1 flex-wrap">
            <span class="badge badge-sm" :class="statusBadge.cls">{{ statusBadge.label }}</span>
            <span v-if="team.queued_reset" class="badge badge-sm badge-warning" data-testid="team-card-queued">
              {{ t('deployment.team.queued') }}
            </span>
          </div>
        </div>

        <div v-if="actionsEnabled" class="dropdown dropdown-end">
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            :aria-expanded="menuOpen"
            :aria-label="t('deployment.team.menuLabel')"
            @click.stop="menuOpen = !menuOpen"
          >
            ⋯
          </button>
          <ul
            v-if="menuOpen"
            class="menu menu-sm dropdown-content bg-base-200 rounded-box z-10 w-48 p-1 shadow-md"
            role="menu"
          >
            <li><button type="button" role="menuitem" @click="onReset">{{ t('deployment.team.actions.reset') }}</button></li>
            <li><button type="button" role="menuitem" @click="onSnapshot">{{ t('deployment.team.actions.snapshot') }}</button></li>
            <li><button type="button" role="menuitem" @click="onRollback">{{ t('deployment.team.actions.rollback') }}</button></li>
            <li><button type="button" role="menuitem" @click="onCopySsh">{{ t('deployment.team.actions.copySsh') }}</button></li>
            <li><button type="button" role="menuitem" @click="onOpenTerminal">{{ t('deployment.team.actions.openTerminal') }}</button></li>
          </ul>
        </div>
      </header>

      <button
        type="button"
        class="text-left text-xs rounded bg-base-200/60 p-2 font-mono leading-snug hover:bg-base-200 transition-colors"
        :aria-label="t('deployment.team.openLogs')"
        @click="onOpenLogs"
      >
        <div v-if="latestLines.length === 0" class="text-base-content/50">
          {{ t('deployment.team.noLogsYet') }}
        </div>
        <div
          v-for="(line, i) in latestLines"
          :key="i"
          class="truncate"
          :class="line.stream === 'stderr' ? 'text-error' : ''"
        >{{ line.text }}</div>
      </button>

      <footer v-if="team.snapshots?.length" class="text-xs text-base-content/60">
        {{ t('deployment.team.snapshotCount', { n: team.snapshots.length }) }}
      </footer>
    </div>
  </article>
</template>

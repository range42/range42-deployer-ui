<script setup>
/**
 * Activity terminal — unified, read-only feed of Proxmox and deployment
 * activity. Docks beside the Problems panel below the canvas. Supports source
 * filtering (all / proxmox / deploy), clearing the session log, and closing.
 */
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '../../i18n'
import { useActivityLogStore } from '@/stores/activityLogStore'

defineEmits(['close'])
const { t } = useI18n()
const store = useActivityLogStore()

const filter = ref('all') // 'all' | 'proxmox' | 'deploy'
const visible = computed(() =>
  filter.value === 'all'
    ? store.entries
    : store.entries.filter((e) => e.source === filter.value),
)

const levelClass = (level) => ({
  pending: 'text-info',
  success: 'text-success',
  error: 'text-error',
  info: 'text-base-content/70',
})[level] || 'text-base-content/70'

onMounted(() => {
  ensureNamespaces(['project'])
})
</script>

<template>
  <section
    class="activity-terminal bg-base-100 border-t border-base-300"
    role="region"
    aria-label="Activity"
    data-testid="activity-terminal"
  >
    <header class="flex items-center justify-between px-4 py-2 border-b border-base-300">
      <div class="flex items-center gap-3">
        <h2 class="font-semibold text-sm">{{ t('project.activityTerminal.title') }}</h2>
        <div class="join">
          <button
            class="btn btn-xs join-item"
            :class="{ 'btn-active': filter === 'all' }"
            data-testid="filter-all"
            @click="filter = 'all'"
          >{{ t('project.activityTerminal.filterAll') }}</button>
          <button
            class="btn btn-xs join-item"
            :class="{ 'btn-active': filter === 'proxmox' }"
            data-testid="filter-proxmox"
            @click="filter = 'proxmox'"
          >{{ t('project.activityTerminal.filterProxmox') }}</button>
          <button
            class="btn btn-xs join-item"
            :class="{ 'btn-active': filter === 'deploy' }"
            data-testid="filter-deploy"
            @click="filter = 'deploy'"
          >{{ t('project.activityTerminal.filterDeploy') }}</button>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button class="btn btn-xs btn-ghost" data-testid="activity-clear" @click="store.clear()">
          {{ t('project.activityTerminal.clear') }}
        </button>
        <button
          class="btn btn-xs btn-ghost"
          :aria-label="t('project.activityTerminal.close')"
          @click="$emit('close')"
        >✕</button>
      </div>
    </header>

    <div v-if="visible.length" class="max-h-56 overflow-y-auto font-mono text-xs p-2 space-y-0.5">
      <div v-for="e in visible" :key="e.id" :class="levelClass(e.level)">
        <span class="opacity-50">[{{ e.source }}]</span>
        <span class="font-semibold"> {{ e.target }}</span>
        <span> — {{ e.message }}</span>
      </div>
    </div>
    <p v-else class="px-4 py-3 text-xs opacity-60" data-testid="activity-empty">
      {{ t('project.activityTerminal.empty') }}
    </p>
  </section>
</template>

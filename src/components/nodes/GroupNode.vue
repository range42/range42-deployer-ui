<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps(['data', 'selected'])
const emit = defineEmits(['update:kind', 'update:scope', 'update:expanded'])

const GROUP_KIND_TOPOLOGY = 'topology_group'
const GROUP_KIND_TEAM_SCOPE = 'team_scope'

// Normalize kind (default: topology_group)
const kind = computed(() => {
  const k = props.data?.kind
  return k === GROUP_KIND_TEAM_SCOPE ? GROUP_KIND_TEAM_SCOPE : GROUP_KIND_TOPOLOGY
})

const isTeamScope = computed(() => kind.value === GROUP_KIND_TEAM_SCOPE)

// team_count is either an explicit override or a fallback default
const teamCount = computed(() => {
  const n = Number(props.data?.team_count ?? props.data?.defaults?.team_count ?? 1)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
})

const expandedPreview = computed(() => !!props.data?._expanded_preview)

const statusColor = computed(() => {
  switch (props.data?.status) {
    case 'gray': return 'bg-gray-400'
    case 'orange': return 'bg-orange-400'
    case 'green': return 'bg-green-400'
    case 'red': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
})

function toggleKind() {
  const next = isTeamScope.value ? GROUP_KIND_TOPOLOGY : GROUP_KIND_TEAM_SCOPE
  emit('update:kind', next)
  emit('update:scope', next)
}

function toggleExpanded() {
  emit('update:expanded', !expandedPreview.value)
}

// Render N-1 duplicated outlines when expanded preview is on (cap at 6 for display)
const previewClones = computed(() => {
  if (!expandedPreview.value || !isTeamScope.value) return []
  const count = Math.min(teamCount.value, 6)
  // 0 is the primary group itself; clones are 1..count-1
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => i + 1)
})
</script>

<template>
  <div
    class="group-container relative w-full h-full"
    :data-kind="kind"
    :data-team-count="teamCount"
    :class="{
      'ring-2 ring-slate-500 ring-offset-2': selected && !isTeamScope,
      'ring-2 ring-indigo-500 ring-offset-2': selected && isTeamScope,
      'shadow-xl': selected,
    }"
  >
    <!-- Node Resizer -->
    <NodeResizer
      min-width="350"
      min-height="250"
      max-width="1200"
      max-height="900"
    />

    <!-- Expanded replication preview — faint duplicated outlines (team_scope only) -->
    <div
      v-if="expandedPreview && isTeamScope"
      class="pointer-events-none absolute inset-0 z-0"
      aria-hidden="true"
    >
      <div
        v-for="i in previewClones"
        :key="`clone-${i}`"
        class="absolute rounded-xl border-2 border-dashed border-indigo-400/40 dark:border-indigo-300/30"
        :style="{
          inset: `${i * 6}px`,
          transform: `translate(${i * 8}px, ${i * 8}px)`,
          opacity: Math.max(0.15, 0.55 - i * 0.08),
        }"
      >
        <span class="absolute -top-3 -left-3 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/80 text-white font-semibold">
          team {{ i + 1 }}
        </span>
      </div>
    </div>

    <!-- Group Background -->
    <div
      class="absolute inset-0 rounded-xl transition-all duration-200 border-2"
      :class="{
        'border-dashed': true,
        'bg-gradient-to-br from-slate-100/80 via-gray-50/50 to-slate-100/80 dark:from-slate-800/40 dark:via-gray-900/30 dark:to-slate-800/40': !isTeamScope,
        'border-slate-400/60 dark:border-slate-500/50': !isTeamScope,
        'hover:from-slate-200/80 hover:via-gray-100/50 hover:to-slate-200/80 dark:hover:from-slate-700/40 dark:hover:via-gray-800/30 dark:hover:to-slate-700/40': !isTeamScope,
        'bg-gradient-to-br from-indigo-100/70 via-violet-50/40 to-indigo-100/70 dark:from-indigo-900/30 dark:via-violet-900/20 dark:to-indigo-900/30': isTeamScope,
        'border-indigo-500/70 dark:border-indigo-400/70 border-[3px]': isTeamScope,
      }"
    />

    <!-- Corner Accent -->
    <div class="absolute top-0 left-0 w-12 h-12 bg-gradient-to-br from-slate-400/20 to-transparent rounded-tl-xl" />
    <div class="absolute bottom-0 right-0 w-12 h-12 bg-gradient-to-tl from-slate-400/20 to-transparent rounded-br-xl" />

    <!-- Group Header -->
    <div class="absolute top-4 left-5 right-5 flex items-center justify-between pointer-events-none z-10">
      <div class="flex items-center space-x-3">
        <div :class="`w-4 h-4 rounded-full ${statusColor} ring-2 ring-white/50`"></div>
        <AppIcon :name="isTeamScope ? 'container' : 'folder'" class="w-6 h-6" />
        <div>
          <div
            class="text-base font-bold"
            :class="isTeamScope
              ? 'text-indigo-800 dark:text-indigo-200'
              : 'text-slate-800 dark:text-slate-200'"
          >
            {{ data?.config?.name || (isTeamScope ? 'Team Scope' : 'Group') }}
          </div>
          <div
            v-if="data?.config?.description"
            class="text-xs max-w-[200px] truncate"
            :class="isTeamScope
              ? 'text-indigo-700/80 dark:text-indigo-300/70'
              : 'text-slate-600/80 dark:text-slate-300/70'"
          >
            {{ data.config.description }}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 pointer-events-auto">
        <!-- Team-scope replication chip -->
        <div
          v-if="isTeamScope"
          class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-600/90 text-white text-[11px] font-semibold shadow-md"
          :data-testid="`team-scope-chip-${data?.id || ''}`"
          :title="`Replicated ${teamCount} times at deploy`"
        >
          <AppIcon name="container" class="w-3.5 h-3.5" />
          <span>×{{ teamCount }} at deploy</span>
        </div>

        <!-- Kind badge / toggle -->
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-full shadow-lg transition-colors"
          :class="isTeamScope
            ? 'bg-indigo-700/90 text-white hover:bg-indigo-800'
            : 'bg-slate-600/90 text-white hover:bg-slate-700'"
          :data-testid="`group-kind-toggle-${data?.id || ''}`"
          :aria-pressed="isTeamScope"
          :title="isTeamScope ? 'Convert to plain group' : 'Convert to team_scope (replicated)'"
          @click.stop="toggleKind"
        >
          {{ isTeamScope ? 'Team Scope' : 'Group' }}
        </button>

        <!-- Expand preview toggle (team-scope only) -->
        <button
          v-if="isTeamScope"
          type="button"
          class="px-2 py-1.5 text-xs font-medium rounded-full bg-white/90 text-indigo-800 hover:bg-white shadow"
          :data-testid="`group-expand-toggle-${data?.id || ''}`"
          :aria-pressed="expandedPreview"
          :title="expandedPreview ? 'Hide replication preview' : 'Show replication preview'"
          @click.stop="toggleExpanded"
        >
          {{ expandedPreview ? 'Collapse' : 'Expand' }}
        </button>
      </div>
    </div>

    <!-- Tags -->
    <div v-if="data?.config?.tags?.length" class="absolute top-16 left-5 flex flex-wrap gap-1 z-10">
      <span
        v-for="tag in data.config.tags.slice(0, 3)"
        :key="tag"
        class="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full"
      >
        {{ tag }}
      </span>
      <span v-if="data.config.tags.length > 3" class="text-xs text-slate-500">
        +{{ data.config.tags.length - 3 }}
      </span>
    </div>

    <!-- Resource Pool Badge -->
    <div v-if="data?.config?.resourcePool" class="absolute top-16 right-5 z-10">
      <div class="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-md font-medium">
        Pool: {{ data.config.resourcePool }}
      </div>
    </div>

    <!-- Drop Zone Hint -->
    <div
      v-if="!data?.hasChildren"
      class="absolute inset-0 flex items-center justify-center pointer-events-none z-5"
    >
      <div class="text-center opacity-40 mt-10">
        <AppIcon name="cube" class="w-10 h-10 mx-auto mb-2" />
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-300">Drop components here</div>
        <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {{ isTeamScope ? 'Per-team items, replicated at deploy' : 'Networks, VMs, services...' }}
        </div>
      </div>
    </div>

    <!-- Connection Handles -->
    <Handle
      type="target"
      :position="Position.Top"
      class="!bg-slate-500 !border-2 !border-slate-700 !w-4 !h-4 !rounded-full"
      :style="{ top: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
    <Handle
      type="source"
      :position="Position.Bottom"
      class="!bg-slate-500 !border-2 !border-slate-700 !w-4 !h-4 !rounded-full"
      :style="{ bottom: '-8px', left: '50%', transform: 'translateX(-50%)' }"
    />
  </div>
</template>

<style scoped>
.group-container {
  min-width: 350px;
  min-height: 250px;
}

.group-container * {
  transition: all 0.2s ease;
}
</style>

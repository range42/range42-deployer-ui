<script setup>
/**
 * <PreflightReport> — Plan C §C4.2
 *
 * Renders the persisted preflight record produced by the backend.
 * Props:
 *   record: {
 *     checks: { check: string, result: 'pass'|'warn'|'block', detail?: string, category?: string }[]
 *     ok: boolean
 *     blocking: boolean
 *     generated_at: string
 *     attempt_id?: string
 *   }
 *
 * Groups by category in a fixed order; each row shows pass/warn/block.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  record: {
    type: Object,
    required: true,
  },
})

const { t } = useI18n({ useScope: 'global' })

const CATEGORY_ORDER = ['resources', 'vmids', 'ips', 'sdn', 'git', 'secrets']

// Auto-infer category from check name when not provided.
function inferCategory(check) {
  const n = (check || '').toLowerCase()
  if (n.includes('vmid')) return 'vmids'
  if (n.includes('ip') || n.includes('subnet')) return 'ips'
  if (n.includes('sdn') || n.includes('bridge')) return 'sdn'
  if (n.includes('git') || n.includes('source')) return 'git'
  if (n.includes('secret') || n.includes('vault')) return 'secrets'
  return 'resources'
}

const grouped = computed(() => {
  const groups = {}
  for (const check of props.record.checks || []) {
    const cat = check.category || inferCategory(check.check)
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(check)
  }
  // Preserve category order; keep unknown categories at the end.
  const ordered = []
  for (const cat of CATEGORY_ORDER) {
    if (groups[cat]) ordered.push({ category: cat, checks: groups[cat] })
  }
  for (const cat of Object.keys(groups)) {
    if (!CATEGORY_ORDER.includes(cat)) {
      ordered.push({ category: cat, checks: groups[cat] })
    }
  }
  return ordered
})

const resultBadge = (result) => {
  switch (result) {
    case 'pass':  return { cls: 'badge-success', label: t('deployment.preflight.result.pass') }
    case 'warn':  return { cls: 'badge-warning', label: t('deployment.preflight.result.warn') }
    case 'block': return { cls: 'badge-error',   label: t('deployment.preflight.result.block') }
    default:      return { cls: 'badge-ghost',   label: result || '—' }
  }
}

const overallResult = computed(() => {
  if (props.record.blocking || props.record.checks?.some(check => check.result === 'block')) return 'block'
  if (props.record.result) return props.record.result
  if (props.record.ok) return 'pass'
  return 'warn'
})
const overallCls = computed(() => ({ pass: 'alert-success', warn: 'alert-warning', block: 'alert-error' })[overallResult.value])
</script>

<template>
  <section class="preflight-report flex flex-col gap-4" data-testid="preflight-report">
    <div class="alert" :class="overallCls" role="status">
      <div class="flex-1">
        <h2 class="font-semibold">
          <template v-if="overallResult === 'block'">{{ t('deployment.preflight.summary.block') }}</template>
          <template v-else-if="overallResult === 'warn'">{{ t('deployment.preflight.summary.warn') }}</template>
          <template v-else>{{ t('deployment.preflight.summary.ok') }}</template>
        </h2>
        <p class="text-xs opacity-80">
          {{ t('deployment.preflight.generatedAt') }}: {{ record.ts || record.generated_at }}
          <span v-if="record.attempt_id"> · {{ t('deployment.preflight.attempt') }}: {{ record.attempt_id }}</span>
        </p>
      </div>
    </div>

    <div
      v-for="group in grouped"
      :key="group.category"
      class="card card-compact bg-base-100 border border-base-300"
    >
      <div class="card-body p-4">
        <h3 class="card-title text-sm capitalize">
          {{ t(`deployment.preflight.category.${group.category}`, group.category) }}
        </h3>
        <ul class="divide-y divide-base-200">
          <li
            v-for="(check, idx) in group.checks"
            :key="idx"
            class="py-2 flex items-start justify-between gap-2"
            data-testid="preflight-check-row"
          >
            <div class="min-w-0 flex-1">
              <div class="font-mono text-xs font-medium">{{ check.check }}</div>
              <div v-if="check.detail" class="text-xs text-base-content/70 mt-1">{{ check.detail }}</div>
            </div>
            <span class="badge badge-sm shrink-0" :class="resultBadge(check.result).cls">
              {{ resultBadge(check.result).label }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="!record.checks?.length" class="text-sm text-base-content/60 italic">
      {{ t('deployment.preflight.empty') }}
    </div>
  </section>
</template>

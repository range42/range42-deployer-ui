<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'

const { t: _t } = useI18n()
function t(key, values) {
  const full = `sources.${key}`
  const translated = _t(full, values || {})
  // If the translation is missing, vue-i18n returns the key itself.
  if (translated === full) {
    const fallback = {
      test_connection: 'Test',
      rotate_token: 'Rotate token',
      remove: 'Remove',
      access_writable: 'Writable',
      access_readonly: 'Read-only',
    }
    return fallback[key] || key
  }
  return translated
}

const props = defineProps({
  source: { type: Object, required: true },
  health: { type: Object, default: () => ({ status: 'unknown' }) },
  busy: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

defineEmits(['test', 'remove', 'rotate-token'])

const statusClass = computed(() => {
  switch (props.health?.status) {
    case 'ok':
      return 'bg-success'
    case 'degraded':
      return 'bg-warning'
    case 'down':
      return 'bg-error'
    default:
      return 'bg-base-300'
  }
})

const providerIconName = computed(() => {
  // The icon registry does not yet carry per-provider brand icons,
  // so we fall back to a neutral link icon. Provider name still shown as a badge.
  return 'link'
})

const checkedLabel = computed(() => {
  const iso = props.health?.checked_at || props.source?.repos?.find((repo) => repo.last_refreshed_at)?.last_refreshed_at
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
})

const displayName = computed(() => {
  return props.source?.name || props.source?.base_url || props.source?.id || 'source'
})

// Real write-access flag. Prefer the source-level `writable` field; fall back to
// the health probe's `writable`. When neither is a boolean, access is unknown
// (e.g. before the first successful health check) and no badge is shown.
const writable = computed(() => {
  if (typeof props.source?.writable === 'boolean') return props.source.writable
  if (typeof props.health?.writable === 'boolean') return props.health.writable
  return null
})
</script>

<template>
  <div
    class="source-health-row flex flex-wrap items-start gap-3 p-4 border border-base-300 rounded-xl bg-base-100"
    :data-source-id="source?.id"
  >
    <div class="shrink-0 w-8 h-8 rounded-lg bg-base-200 flex items-center justify-center">
      <AppIcon :name="providerIconName" class="w-5 h-5" />
    </div>

    <div class="flex-1 min-w-0 basis-48">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-block w-2 h-2 rounded-full"
          :class="statusClass"
          :aria-label="t(`status_${health?.status || 'unknown'}`)"
        />
        <span class="font-medium truncate">{{ displayName }}</span>
        <span class="badge badge-ghost badge-sm uppercase">{{ source?.provider }}</span>
        <span
          v-if="writable !== null"
          class="badge badge-sm"
          :class="writable ? 'badge-success' : 'badge-ghost'"
          data-testid="source-access-badge"
        >
          {{ writable ? t('access_writable') : t('access_readonly') }}
        </span>
      </div>
      <div class="text-xs text-base-content/70 mt-2 space-y-1">
        <p v-for="repo in source.repos" :key="`${repo.owner}/${repo.repo}`" class="break-all">
          {{ source.base_url.replace(/\/+$/, '') }}/{{ repo.owner }}/{{ repo.repo }}
          <span class="badge badge-ghost badge-xs ml-1">{{ repo.branch }}</span>
        </p>
        <p v-if="busy" role="status">{{ t('working') }}</p>
        <p v-else-if="typeof health?.entries_indexed === 'number'">{{ t('entry_count', { count: health.entries_indexed }) }}</p>
        <p v-else>{{ t(`status_${health?.status || 'unknown'}`) }}</p>
        <p v-if="health?.repos_seen === 0" class="text-warning">{{ t('no_repositories') }}</p>
        <p v-else-if="health?.entries_indexed === 0" class="text-warning">{{ t('no_entries') }}</p>
        <p v-if="checkedLabel">{{ t('last_refreshed', { time: checkedLabel }) }}</p>
        <p v-if="health?.error" class="text-error break-words">{{ health.error }}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1 shrink-0">
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        :aria-label="t('refresh_source', { name: displayName })"
        :disabled="disabled || busy"
        @click="$emit('test', source)"
      >
        {{ t('refresh') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        :aria-label="`Rotate token for ${displayName}`"
        :disabled="disabled || busy"
        @click="$emit('rotate-token', source)"
      >
        {{ t('rotate_token') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs text-error"
        :aria-label="`Remove ${displayName}`"
        :disabled="disabled || busy"
        @click="$emit('remove', source)"
      >
        {{ t('remove') }}
      </button>
    </div>
  </div>
</template>

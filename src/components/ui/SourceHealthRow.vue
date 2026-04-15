<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'

const { t: _t } = useI18n()
function t(key) {
  const full = `sources.${key}`
  const translated = _t(full)
  // If the translation is missing, vue-i18n returns the key itself.
  if (translated === full) {
    const fallback = {
      test_connection: 'Test',
      rotate_token: 'Rotate token',
      remove: 'Remove',
    }
    return fallback[key] || key
  }
  return translated
}

const props = defineProps({
  source: { type: Object, required: true },
  health: { type: Object, default: () => ({ status: 'unknown' }) },
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

const rttLabel = computed(() => {
  const rtt = props.health?.rtt_ms
  if (typeof rtt !== 'number') return '—'
  return `${Math.round(rtt)} ms`
})

function relativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const checkedLabel = computed(() => relativeTime(props.health?.checked_at))

const displayName = computed(() => {
  return props.source?.name || props.source?.base_url || props.source?.id || 'source'
})
</script>

<template>
  <div
    class="source-health-row flex items-center gap-3 p-3 border border-base-300 rounded-xl bg-base-100"
    :data-source-id="source?.id"
  >
    <div class="shrink-0 w-8 h-8 rounded-lg bg-base-200 flex items-center justify-center">
      <AppIcon :name="providerIconName" class="w-5 h-5" />
    </div>

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span
          class="inline-block w-2 h-2 rounded-full"
          :class="statusClass"
          :aria-label="`status ${health?.status || 'unknown'}`"
        />
        <span class="font-medium truncate">{{ displayName }}</span>
        <span class="badge badge-ghost badge-sm uppercase">{{ source?.provider }}</span>
      </div>
      <div class="text-xs text-base-content/60 mt-0.5 flex items-center gap-3">
        <span>rtt: {{ rttLabel }}</span>
        <span v-if="checkedLabel">checked: {{ checkedLabel }}</span>
        <span v-if="health?.error" class="text-error truncate">{{ health.error }}</span>
      </div>
    </div>

    <div class="flex items-center gap-1 shrink-0">
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        :aria-label="`Test ${displayName}`"
        @click="$emit('test', source)"
      >
        {{ t('test_connection') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        :aria-label="`Rotate token for ${displayName}`"
        @click="$emit('rotate-token', source)"
      >
        {{ t('rotate_token') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs text-error"
        :aria-label="`Remove ${displayName}`"
        @click="$emit('remove', source)"
      >
        {{ t('remove') }}
      </button>
    </div>
  </div>
</template>

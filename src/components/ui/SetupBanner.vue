<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSetupStatus } from '@/composables/useSetupStatus'

const emit = defineEmits(['open'])
const { t } = useI18n()
const { setupComplete } = useSetupStatus()

const DISMISS_KEY = 'range42_setup_banner_dismissed'
const dismissed = ref(localStorage.getItem(DISMISS_KEY) === '1')

// Non-blocking: shown only while setup is incomplete AND not dismissed. The
// Dashboard always renders underneath regardless.
const visible = computed(() => !setupComplete.value && !dismissed.value)

function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="alert bg-base-200 border border-base-300 rounded-none flex items-center justify-between gap-3"
    data-testid="setup-banner"
  >
    <div class="min-w-0">
      <div class="font-medium">{{ t('home.banner.title') }}</div>
      <p class="text-sm text-base-content/70">{{ t('home.banner.body') }}</p>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <button type="button" class="btn btn-primary btn-sm" @click="emit('open')">
        {{ t('home.banner.open') }}
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="setup-banner-dismiss"
        @click="dismiss"
      >
        {{ t('home.banner.dismiss') }}
      </button>
    </div>
  </div>
</template>

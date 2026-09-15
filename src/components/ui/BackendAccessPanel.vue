<script setup>
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { ensureNamespaces } from '@/i18n'

const backend = useBackendApiStore()
const { t } = useI18n()
const token = ref('')
const error = ref('')
const connecting = ref(false)
onMounted(() => ensureNamespaces(['common']))
watch([() => backend.activeHost?.id, () => backend.url, () => backend.token], () => {
  token.value = ''
  error.value = ''
  if (backend.activeHost) backend.testConnection()
}, { immediate: true })

async function connect() {
  connecting.value = true
  error.value = ''
  try {
    await backend.connectToken(token.value)
    token.value = ''
  } catch (cause) {
    error.value = cause?.message || t('common.backend_access.failed')
  } finally {
    connecting.value = false
  }
}
</script>

<template>
  <section v-if="backend.requiresAuthentication" class="m-4 rounded-xl border border-warning/40 bg-warning/10 p-4" data-testid="backend-access-panel" aria-labelledby="backend-access-title">
    <h2 id="backend-access-title" class="font-semibold">{{ t('common.backend_access.title') }}</h2>
    <p class="text-sm mt-1 break-all">{{ backend.url }}</p>
    <p class="text-sm mt-2">{{ t('common.backend_access.description') }}</p>
    <form class="mt-3 flex flex-wrap items-end gap-3" @submit.prevent="connect">
      <label class="form-control flex-1 min-w-0">
        <span class="label label-text">{{ t('common.backend_access.token') }}</span>
        <input v-model="token" type="password" class="input input-bordered w-full" autocomplete="off" :disabled="connecting" required data-testid="backend-access-token" />
      </label>
      <button type="submit" class="btn btn-primary" :disabled="connecting || !token.trim()">{{ t(connecting ? 'common.backend_access.connecting' : 'common.backend_access.connect') }}</button>
    </form>
    <p class="text-xs text-base-content/70 mt-2">{{ t('common.backend_access.storage') }}</p>
    <p v-if="error" role="alert" class="text-sm text-error mt-2">{{ error }}</p>
  </section>
</template>

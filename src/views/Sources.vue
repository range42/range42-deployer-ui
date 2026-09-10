<script setup>
defineOptions({ name: 'SourcesView' })

import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useBackendApiStore } from '@/stores/backendApiStore'
import { useCatalogSources, DEFAULT_CATALOG_URL } from '@/composables/useCatalogSources'
import { getBackendScope } from '@/services/backendApi'
import SourceHealthRow from '@/components/ui/SourceHealthRow.vue'
import AddSourceModal from '@/components/AddSourceModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { ensureNamespaces } from '@/i18n'

const { t } = useI18n()
const inv = useInventoryStore()
const backend = useBackendApiStore()
const api = useCatalogSources()
const addModalOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const pageError = ref('')
const busyId = ref(null)
const rotatingId = ref(null)
const rotateToken = ref('')
const rotateError = ref('')
const rotating = ref(false)
const busy = computed(() => api.loading.value || saving.value || rotating.value || busyId.value !== null)
const sources = computed(() => inv.sources.filter((source) => source.backend_url === getBackendScope()))
const defaultSource = computed(() => sources.value.find((source) =>
  source.provider === 'github' && source.auth.kind === 'none' &&
  source.base_url.replace(/\/+$/, '') === 'https://github.com' &&
  source.repos?.length === 1 &&
  source.repos.some((repo) => repo.owner === 'range42' && repo.repo === 'range42-catalog' && repo.branch === 'main'),
))
const backendLabel = computed(() => backend.activeHost?.label || t('sources.current_backend'))
const message = (error) => error?.message || String(error)

onMounted(() => ensureNamespaces(['sources', 'common']))

async function reload() {
  const scope = getBackendScope()
  pageError.value = ''
  try {
    await api.loadSources()
  } catch (error) {
    if (scope === getBackendScope()) pageError.value = message(error)
  }
}

watch(getBackendScope, () => {
  addModalOpen.value = false
  rotatingId.value = null
  rotateToken.value = ''
  reload()
}, { immediate: true })

function openAdd() {
  formError.value = ''
  addModalOpen.value = true
}

async function handleAdd(payload) {
  saving.value = true
  formError.value = ''
  let source
  try {
    source = await api.createSource(payload)
    addModalOpen.value = false
  } catch (error) {
    formError.value = message(error)
  } finally {
    saving.value = false
  }
  if (source) await runHealth(source.id)
}

async function connectDefault() {
  busyId.value = 'default'
  pageError.value = ''
  try {
    const source = await api.connectDefault()
    busyId.value = source.id
    await api.refreshSource(source.id)
  } catch (error) {
    pageError.value = message(error)
  } finally {
    busyId.value = null
  }
}

async function runHealth(id) {
  busyId.value = id
  pageError.value = ''
  try {
    await api.refreshSource(id)
  } catch (error) {
    pageError.value = message(error)
  } finally {
    busyId.value = null
  }
}

async function handleRemove(source) {
  busyId.value = source.id
  pageError.value = ''
  try {
    await api.deleteSource(source.id)
  } catch (error) {
    pageError.value = message(error)
  } finally {
    busyId.value = null
  }
}

function openRotate(source) {
  rotatingId.value = source.id
  rotateToken.value = ''
  rotateError.value = ''
}

async function submitRotate(token) {
  rotating.value = true
  rotateError.value = ''
  try {
    await api.rotateToken(rotatingId.value, token)
    rotatingId.value = null
    rotateToken.value = ''
  } catch (error) {
    rotateError.value = message(error)
  } finally {
    rotating.value = false
  }
}

function cancelRotate() {
  if (rotating.value) return
  rotatingId.value = null
  rotateToken.value = ''
  rotateError.value = ''
}
</script>

<template>
  <section class="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('sources.title') }}</h1>
        <p class="text-sm text-base-content/70 mt-1">{{ t('sources.subtitle') }}</p>
        <p class="text-xs text-base-content/60 mt-2">{{ t('sources.backend_label', { name: backendLabel }) }}</p>
      </div>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="openAdd">{{ t('sources.add') }}</button>
    </header>

    <div class="rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6" data-testid="default-source-card">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="badge badge-primary badge-outline">{{ t('sources.recommended') }}</span>
        <span class="text-xs text-base-content/70">{{ t('sources.public_no_token') }}</span>
      </div>
      <h2 class="text-lg font-semibold">{{ t('sources.default_title') }}</h2>
      <p class="text-sm text-base-content/75 mt-2 max-w-2xl">{{ t('sources.default_description') }}</p>
      <a :href="DEFAULT_CATALOG_URL" target="_blank" rel="noopener noreferrer" class="link link-hover text-sm text-primary break-all inline-block mt-2">{{ DEFAULT_CATALOG_URL }}</a>
      <div class="flex flex-wrap items-center gap-3 mt-5">
        <template v-if="defaultSource">
          <RouterLink to="/catalog" class="btn btn-primary btn-sm">{{ t('sources.browse_catalog') }}</RouterLink>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="runHealth(defaultSource.id)">{{ t('sources.refresh') }}</button>
        </template>
        <button v-else type="button" data-testid="connect-default-source" class="btn btn-primary" :disabled="busy" @click="connectDefault">
          <span v-if="busyId === 'default'" class="loading loading-spinner loading-xs" aria-hidden="true" />
          {{ t('sources.connect_default') }}
        </button>
        <span v-if="busyId" class="text-sm text-base-content/70" role="status">{{ t('sources.working') }}</span>
      </div>
    </div>

    <div v-if="pageError" role="alert" class="alert alert-error items-start">
      <div class="min-w-0 flex-1"><p class="font-medium">{{ t('sources.action_failed') }}</p><p class="text-sm break-words">{{ pageError }}</p></div>
      <button type="button" class="btn btn-sm btn-ghost" :disabled="busy" @click="reload">{{ t('sources.reload') }}</button>
    </div>

    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold">{{ t('sources.connected_sources') }} <span class="text-base-content/60">({{ sources.length }})</span></h2>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="reload">{{ t('sources.reload') }}</button>
      </div>
      <div v-if="api.loading.value" class="flex items-center gap-2 text-sm text-base-content/70 p-4" role="status">
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />{{ t('sources.loading') }}
      </div>
      <EmptyState v-else-if="sources.length === 0" :title="t('sources.empty_title')" :description="t('sources.empty_desc')" />
      <ul v-else class="space-y-3" data-testid="sources-list">
        <li v-for="source in sources" :key="source.id">
          <SourceHealthRow :source="source" :health="source.health || { status: 'unknown' }" :busy="busyId === source.id" :disabled="busy"
            @test="runHealth(source.id)" @remove="handleRemove" @rotate-token="openRotate" />
        </li>
      </ul>
    </div>

    <AddSourceModal :open="addModalOpen" :busy="saving" :error="formError" @close="addModalOpen = false" @submit="handleAdd" />

    <div v-if="rotatingId" class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="rotate-source-title" @keydown.esc="cancelRotate">
      <form class="modal-box max-w-sm" @submit.prevent="submitRotate(rotateToken.trim())">
        <h3 id="rotate-source-title" class="font-bold text-lg">{{ t('sources.rotate_token') }}</h3>
        <p class="text-sm text-base-content/70 mt-2 mb-3">{{ t('sources.rotate_hint') }}</p>
        <label class="form-control block">
          <span class="label label-text">{{ t('sources.token_label') }}</span>
          <input v-model="rotateToken" data-testid="rotate-token-input" type="password" class="input input-bordered w-full" autocomplete="new-password" :disabled="rotating" />
        </label>
        <p v-if="rotateError" role="alert" class="text-sm text-error mt-3">{{ rotateError }}</p>
        <div class="modal-action flex-wrap">
          <button type="button" class="btn btn-ghost" :disabled="rotating" @click="cancelRotate">{{ t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" data-testid="save-source-token" :disabled="rotating || !rotateToken.trim()" @click="submitRotate(rotateToken.trim())">{{ t('common.save') }}</button>
        </div>
        <button type="button" class="btn btn-link btn-sm px-0 mt-2" :disabled="rotating" @click="submitRotate('')">{{ t('sources.use_public_access') }}</button>
      </form>
      <div class="modal-backdrop" @click="cancelRotate" />
    </div>
  </section>
</template>

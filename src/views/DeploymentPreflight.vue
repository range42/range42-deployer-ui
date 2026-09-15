<script setup>
/**
 * /deployments/:id/preflight — Plan C §C4.5
 *
 * Shareable record view that fetches the persisted preflight report from
 * the backend (`GET /v1/deployments/:id/preflight`) and renders it via the
 * reusable <PreflightReport> primitive. The route is intentionally public
 * within the app: the URL is stable, so anyone with the link can view the
 * same record. A copy-URL button puts the current full URL on the
 * clipboard. The page title surfaces codename + scenario label so the
 * record is self-describing when shared out-of-band.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureNamespaces } from '@/i18n'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'
import PreflightReport from '@/components/ui/PreflightReport.vue'

const route = useRoute()
const backend = useBackendApiStore()
let requestVersion = 0
const { t } = useI18n({ useScope: 'global' })

const meta = ref(null)      // deployment metadata (codename + scenario label)
const record = ref(null)    // preflight record itself
const loading = ref(true)
const loadError = ref(null) // 'not_found' | string | null
const copied = ref(false)

const deploymentId = computed(() => String(route.params.id))

/**
 * The shareable URL — the current full URL. We use `window.location.href`
 * directly because the record is keyed by deployment + attempt and the
 * `?attempt=` query param (if the backend surfaces attempt_id) must be
 * preserved. SSR-safe fallback returns an empty string.
 */
const shareUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return window.location.href
})

const pageTitle = computed(() => {
  const codename = meta.value?.codename || deploymentId.value
  const scenario = meta.value?.scenario_label || meta.value?.scenario
  if (scenario) return `${codename} · ${scenario}`
  return codename
})

const reportKey = computed(() => {
  const att = record.value?.attempt_id || 'no-attempt'
  return `${deploymentId.value}:${att}`
})

async function loadPreflight() {
  const version = ++requestVersion
  const id = deploymentId.value
  loading.value = true
  loadError.value = null
  record.value = null
  meta.value = null
  const [metaResult, reportResult] = await Promise.allSettled([
    backendRequest(`/v1/deployments/${encodeURIComponent(id)}`),
    backendRequest(`/v1/deployments/${encodeURIComponent(id)}/preflight`),
  ])
  if (version !== requestVersion) return
  if (metaResult.status === 'fulfilled') meta.value = metaResult.value
  if (reportResult.status === 'fulfilled') record.value = reportResult.value
  else {
    const error = reportResult.reason
    loadError.value = error.status === 404 ? 'not_found' : error.message
  }
  loading.value = false
}

async function copyShareUrl() {
  const url = shareUrl.value
  if (!url) return
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else if (typeof document !== 'undefined') {
      // Fallback for non-secure contexts (e.g. self-signed range42 dev).
      const el = document.createElement('textarea')
      el.value = url
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Soft-fail — user can still copy from the address bar.
  }
}

onMounted(() => { ensureNamespaces(['deployment', 'common']) })
watch([deploymentId, getBackendScope, () => backend.token], loadPreflight, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { requestVersion += 1 })
</script>

<template>
  <section class="max-w-4xl mx-auto p-6" data-testid="preflight-view">
    <!-- Header -->
    <header class="mb-5">
      <div class="text-xs text-base-content/60">
        <router-link
          :to="{ name: 'deployment-detail', params: { id: deploymentId } }"
          class="link"
          data-testid="back-to-deployment"
        >{{ t('deployment.detail.back') }}</router-link>
      </div>
      <div class="flex items-start justify-between gap-3 flex-wrap mt-2">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold" data-testid="preflight-title">
            {{ t('deployment.preflight.title') }} — {{ pageTitle }}
          </h1>
          <p class="text-sm text-base-content/70 mt-1">
            {{ t('deployment.preflight.subtitle') }}
          </p>
        </div>
        <div class="shrink-0">
          <button
            type="button"
            class="btn btn-sm"
            :class="copied ? 'btn-success' : 'btn-outline'"
            data-testid="copy-url-btn"
            :disabled="!shareUrl"
            @click="copyShareUrl"
          >
            <span v-if="!copied">{{ t('deployment.preflight.copyLink') }}</span>
            <span v-else>{{ t('deployment.preflight.linkCopied') }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Loading -->
    <div
      v-if="loading"
      class="text-sm text-base-content/60 italic"
      data-testid="preflight-loading"
    >{{ t('deployment.preflight.loading') }}</div>

    <!-- Error states -->
    <div
      v-else-if="loadError === 'not_found'"
      class="alert alert-error"
      data-testid="preflight-not-found"
    >
      {{ t('deployment.preflight.notFound') }}
    </div>
    <div
      v-else-if="loadError"
      class="alert alert-error"
      data-testid="preflight-error"
    >
      {{ t('deployment.preflight.loadFailed') }}
      <span class="opacity-70 text-xs ml-2">({{ loadError }})</span>
    </div>

    <!-- Record -->
    <PreflightReport
      v-else-if="record"
      :key="reportKey"
      :record="record"
    />
  </section>
</template>

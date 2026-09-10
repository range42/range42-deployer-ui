<script setup>
/**
 * <DeployForm> — Plan C §C4.6
 *
 * Single-step modal that collects deployment parameters, runs preflight
 * against stored project documents, and then POSTs /v1/deployments.
 *
 * Tiered validation:
 *  - client-instant: empty required fields, NaN, codename collision against
 *    the caller-provided `existingCodenames` list.
 *  - backend-on-blur / on button `Run preflight`: POSTs /v1/projects/:id/validate
 *    and surfaces warnings/blocking checks.
 *
 * SHA-pin is displayed read-only and requires an explicit acknowledgement
 * checkbox so the operator confirms the exact catalog + project shas they
 * intend to deploy.
 *
 * On submit:
 *   POST /v1/deployments
 *     { project_id, codename, scenario_label, target_host_id,
 *       team_count, catalog_sha, project_sha, secrets?: { vault_password } }
 *   team_count is required by the backend, so non-gamenet deploys send 1.
 *   Omitted secrets inherit the backend operator credential template. An
 *   explicit custom vault override replaces that template for this deployment.
 *   → redirects to /deployments/:id
 *
 * Props:
 *   visible            — open state
 *   projectId          — current project id
 *   projectName        — friendly label
 *   gamenet            — boolean; when true, team_count field is shown
 *   catalogSha         — sha-pin candidate for the catalog repo
 *   projectSha         — sha-pin candidate for the project overlay
 *   existingCodenames  — string[] of local codenames to prevent collision
 *
 * Emits:
 *   close              — dismiss modal
 *   created(id)        — after successful POST /v1/deployments
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { backendRequest, getBackendScope } from '@/services/backendApi'
import { useBackendApiStore } from '@/stores/backendApiStore'

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectId: { type: String, default: '' },
  projectName: { type: String, default: '' },
  initialScenarioLabel: { type: String, default: '' },
  gamenet: { type: Boolean, default: true },
  catalogSha: { type: String, default: '' },
  projectSha: { type: String, default: '' },
  existingCodenames: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'created'])
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })
const backend = useBackendApiStore()
const backendLabel = computed(() => backend.activeHost?.label || getBackendScope() || t('deployment.deploy.backendSameOrigin'))
let sessionVersion = 0
let hostsVersion = 0
let validationVersion = 0

// ---------- form state ----------
const codename = ref('')
const scenarioLabel = ref(props.initialScenarioLabel)
const usesPinnedScenario = computed(() => !!props.projectSha && scenarioLabel.value.trim() !== '_universal')
const targetHost = ref('')
const teamCount = ref(1)
const vaultPassword = ref('')
const vaultOverride = ref(false)
const shaAck = ref(false)
const warnAck = ref(false)

const hosts = ref([])
const hostsLoading = ref(false)
const hostsError = ref(null)

const preflightRecord = ref(null)
const preflightRunning = ref(false)
const preflightError = ref(null)

const submitting = ref(false)
const submitError = ref(null)

// ---------- validators (client-instant) ----------
const CODENAME_RE = /^[A-Z][A-Z0-9_-]{1,31}$/

const errCodename = computed(() => {
  const v = (codename.value || '').trim().toUpperCase()
  if (!v) return t('deployment.deploy.err.codenameRequired')
  if (!CODENAME_RE.test(v)) return t('deployment.deploy.err.codenameShape')
  if ((props.existingCodenames || []).includes(v)) return t('deployment.deploy.err.codenameTaken')
  return null
})

const errScenario = computed(() => {
  if (!scenarioLabel.value?.trim()) return t('deployment.deploy.err.scenarioRequired')
  return null
})

const errHost = computed(() => {
  if (!targetHost.value || !hosts.value.some(host => host.id === targetHost.value)) {
    return t('deployment.deploy.err.hostRequired')
  }
  return null
})

const errTeamCount = computed(() => {
  if (!props.gamenet) return null
  const n = Number(teamCount.value)
  if (!Number.isFinite(n) || Number.isNaN(n)) return t('deployment.deploy.err.teamCountNaN')
  if (!Number.isInteger(n) || n < 1 || n > 64) return t('deployment.deploy.err.teamCountRange')
  return null
})

const errVault = computed(() => {
  if (vaultOverride.value && !vaultPassword.value.trim()) return t('deployment.deploy.err.vaultRequired')
  return null
})

const hardErrors = computed(() => {
  return [
    errCodename.value,
    errScenario.value,
    errHost.value,
    errTeamCount.value,
    errVault.value,
  ].filter(Boolean)
})

const preflightBlocking = computed(() => {
  const r = preflightRecord.value
  if (!r) return false
  if (r.blocking === true || (r.ok === false && !Array.isArray(r.checks)) || r.errors?.length) return true
  const checks = Array.isArray(r.checks) ? r.checks : []
  return checks.some(c => c.result === 'block')
})

const preflightWarns = computed(() => {
  const r = preflightRecord.value
  if (!r) return []
  const checks = Array.isArray(r.checks) ? r.checks : []
  return checks.filter(c => c.result === 'warn')
})

const canSubmit = computed(() => {
  if (hardErrors.value.length > 0) return false
  if (!shaAck.value) return false
  if (!usesPinnedScenario.value && preflightBlocking.value) return false
  if (!usesPinnedScenario.value && preflightWarns.value.length > 0 && !warnAck.value) return false
  return !submitting.value && !hostsLoading.value && !hostsError.value
    && (usesPinnedScenario.value || (!preflightRunning.value && !preflightError.value))
})

// ---------- load hosts ----------
async function loadHosts() {
  const version = ++hostsVersion
  const session = sessionVersion
  const current = () => session === sessionVersion && version === hostsVersion
  hostsLoading.value = true
  hostsError.value = null
  hosts.value = []
  targetHost.value = ''
  try {
    const loaded = []
    let offset = 0
    while (true) {
      const page = await backendRequest(`/v1/proxmox/hosts?offset=${offset}&limit=100`)
      if (!current()) return
      const items = page.items || []
      loaded.push(...items)
      offset += items.length
      if (items.length === 0 || offset >= page.total || page.total == null) break
    }
    hosts.value = loaded
  } catch (err) {
    if (current()) hostsError.value = err?.message || String(err)
  } finally {
    if (current()) hostsLoading.value = false
  }
}

// This endpoint validates stored project documents. Deployment resource and
// network preflight runs later, against the created deployment's pinned inputs.
async function runPreflight() {
  if (usesPinnedScenario.value || hardErrors.value.length > 0 || preflightRunning.value || submitting.value) return
  const session = sessionVersion
  const version = ++validationVersion
  const current = () => session === sessionVersion && version === validationVersion
  preflightRunning.value = true
  preflightError.value = null
  try {
    const record = await backendRequest(
      `/v1/projects/${encodeURIComponent(props.projectId)}/validate`,
      { method: 'POST' },
    )
    if (!current()) return
    preflightRecord.value = record
    warnAck.value = false
  } catch (err) {
    if (current()) preflightError.value = err?.message || String(err)
  } finally {
    if (current()) preflightRunning.value = false
  }
}

function onBlurTriggerPreflight() {
  if (hardErrors.value.length === 0) runPreflight()
}

// ---------- submit ----------
async function submit() {
  if (!canSubmit.value) return
  const session = sessionVersion
  submitting.value = true
  submitError.value = null
  try {
    const body = {
      project_id: props.projectId,
      codename: codename.value.trim().toUpperCase(),
      scenario_label: scenarioLabel.value.trim(),
      target_host_id: targetHost.value,
      catalog_sha: props.catalogSha,
      project_sha: props.projectSha,
      // Required by DeploymentCreate; a non-gamenet lab is a single team.
      team_count: props.gamenet ? Number(teamCount.value) : 1,
      ...(vaultOverride.value ? { secrets: { vault_password: vaultPassword.value } } : {}),
    }
    const created = await backendRequest('/v1/deployments', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (session !== sessionVersion) return
    emit('created', created?.id)
    emit('close')
    if (created?.id) {
      router.push({ name: 'deployment-detail', params: { id: created.id } })
    }
  } catch (err) {
    if (session === sessionVersion) submitError.value = err?.message || String(err)
  } finally {
    if (session === sessionVersion) submitting.value = false
  }
}

function onCancel() {
  emit('close')
}

watch(
  [() => props.visible, () => props.projectId, getBackendScope, () => backend.token],
  ([visible]) => {
    sessionVersion += 1
    hostsVersion += 1
    validationVersion += 1
    hosts.value = []
    targetHost.value = ''
    hostsLoading.value = false
    hostsError.value = null
    preflightRecord.value = null
    preflightError.value = null
    preflightRunning.value = false
    submitError.value = null
    submitting.value = false
    warnAck.value = false
    shaAck.value = false
    vaultOverride.value = false
    vaultPassword.value = ''
    if (visible) loadHosts()
  },
  { immediate: true, flush: 'sync' },
)

watch([() => props.catalogSha, () => props.projectSha], () => {
  validationVersion += 1
  preflightRecord.value = null
  preflightError.value = null
  preflightRunning.value = false
  warnAck.value = false
  shaAck.value = false
})

watch(vaultOverride, enabled => { if (!enabled) vaultPassword.value = '' })

onBeforeUnmount(() => { sessionVersion += 1 })
</script>

<template>
  <div
    v-if="visible"
    class="modal modal-open z-[100]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="deploy-form-title"
    data-testid="deploy-form"
  >
    <div class="modal-box max-w-2xl">
      <header class="flex items-start justify-between gap-4 mb-4">
        <div class="min-w-0">
          <h2 id="deploy-form-title" class="text-lg font-bold">
            {{ t('deployment.deploy.title') }}
          </h2>
          <p v-if="projectName" class="text-xs text-base-content/60 mt-1 truncate">
            {{ projectName }}
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-square" :aria-label="t('common.close')" @click="onCancel">✕</button>
      </header>

      <p class="text-xs text-base-content/70 mb-3" data-testid="deploy-backend">
        {{ t('deployment.deploy.backend', { backend: backendLabel }) }}
      </p>
      <fieldset class="space-y-3" :disabled="submitting">
        <!-- Codename -->
        <div class="form-control" data-testid="deploy-field-codename">
          <label class="label pb-1">
            <span class="label-text font-medium">{{ t('deployment.deploy.fields.codename') }}<span class="text-error ml-0.5">*</span></span>
          </label>
          <input
            v-model="codename"
            type="text"
            class="input input-bordered input-sm"
            :placeholder="t('deployment.deploy.fields.codenamePlaceholder')"
            :aria-invalid="errCodename ? 'true' : 'false'"
            @blur="onBlurTriggerPreflight"
          />
          <p v-if="errCodename" class="text-xs text-error mt-1" data-testid="deploy-err-codename">{{ errCodename }}</p>
        </div>

        <!-- Scenario label -->
        <div class="form-control" data-testid="deploy-field-scenario">
          <label class="label pb-1">
            <span class="label-text font-medium">{{ t('deployment.deploy.fields.scenario') }}<span class="text-error ml-0.5">*</span></span>
          </label>
          <input
            v-model="scenarioLabel"
            type="text"
            class="input input-bordered input-sm"
            :placeholder="t('deployment.deploy.fields.scenarioPlaceholder')"
            @blur="onBlurTriggerPreflight"
          />
          <p v-if="errScenario" class="text-xs text-error mt-1">{{ errScenario }}</p>
        </div>

        <!-- Target host -->
        <div class="form-control" data-testid="deploy-field-host">
          <label class="label pb-1">
            <span class="label-text font-medium">{{ t('deployment.deploy.fields.host') }}<span class="text-error ml-0.5">*</span></span>
          </label>
          <select
            v-model="targetHost"
            class="select select-bordered select-sm"
            :disabled="hostsLoading || !!hostsError"
            @blur="onBlurTriggerPreflight"
          >
            <option value="" disabled>{{ t('deployment.deploy.fields.hostPlaceholder') }}</option>
            <option v-for="h in hosts" :key="h.id" :value="h.id">
              {{ h.name || h.id }} <span v-if="h.node_name">({{ h.node_name }})</span>
            </option>
          </select>
          <p v-if="hostsLoading" role="status" class="text-xs mt-1">{{ t('deployment.deploy.hostsLoading') }}</p>
          <p v-else-if="!hostsError && !hosts.length" class="text-xs mt-1">{{ t('deployment.deploy.hostsEmpty') }}</p>
          <div v-if="hostsError" role="alert" class="text-xs text-error mt-1">
            {{ hostsError }}
            <button type="button" class="btn btn-xs btn-ghost" data-testid="deploy-hosts-retry" @click="loadHosts">
              {{ t('common.retry') }}
            </button>
          </div>
          <p v-if="errHost" class="text-xs text-error mt-1">{{ errHost }}</p>
        </div>

        <!-- Team count (gamenet only) -->
        <div v-if="gamenet" class="form-control" data-testid="deploy-field-team-count">
          <label class="label pb-1">
            <span class="label-text font-medium">{{ t('deployment.deploy.fields.teamCount') }}<span class="text-error ml-0.5">*</span></span>
          </label>
          <input
            v-model.number="teamCount"
            type="number"
            min="1"
            max="64"
            step="1"
            class="input input-bordered input-sm"
            @blur="onBlurTriggerPreflight"
          />
          <p v-if="errTeamCount" class="text-xs text-error mt-1">{{ errTeamCount }}</p>
        </div>

        <!-- Backend credentials are inherited unless explicitly overridden. -->
        <div class="form-control space-y-2" data-testid="deploy-field-vault">
          <p class="text-sm text-base-content/70">{{ t('deployment.deploy.fields.backendCredentials') }}</p>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="vaultOverride" type="checkbox" class="checkbox checkbox-sm" data-testid="deploy-vault-override" />
            <span>{{ t('deployment.deploy.fields.vaultOverride') }}</span>
          </label>
          <template v-if="vaultOverride">
            <p class="text-xs text-base-content/70">{{ t('deployment.deploy.fields.vaultOverrideHint') }}</p>
            <label class="label pb-1" for="deploy-vault-password">
              <span class="label-text font-medium">{{ t('deployment.deploy.fields.vault') }}<span class="text-error ml-0.5">*</span></span>
            </label>
            <input
              id="deploy-vault-password"
              v-model="vaultPassword"
              type="password"
              class="input input-bordered input-sm"
              autocomplete="new-password"
              :aria-invalid="errVault ? 'true' : 'false'"
            />
            <p v-if="errVault" class="text-xs text-error mt-1">{{ errVault }}</p>
          </template>
        </div>

        <!-- SHA pin confirmation -->
        <div
          class="rounded border border-base-300 bg-base-200/40 p-3"
          data-testid="deploy-sha-pin"
        >
          <h3 class="text-sm font-semibold mb-2">{{ t('deployment.deploy.shaPin.heading') }}</h3>
          <dl class="text-xs space-y-1 font-mono">
            <div class="flex items-center gap-2">
              <dt class="w-28 shrink-0 text-base-content/60">{{ t('deployment.deploy.shaPin.catalog') }}</dt>
              <dd class="truncate">{{ catalogSha || '—' }}</dd>
            </div>
            <div class="flex items-center gap-2">
              <dt class="w-28 shrink-0 text-base-content/60">{{ t('deployment.deploy.shaPin.project') }}</dt>
              <dd class="truncate">{{ projectSha || '—' }}</dd>
            </div>
          </dl>
          <label class="label cursor-pointer justify-start gap-2 mt-2" data-testid="deploy-sha-ack">
            <input v-model="shaAck" type="checkbox" class="checkbox checkbox-sm" />
            <span class="text-xs">{{ t('deployment.deploy.shaPin.ack') }}</span>
          </label>
        </div>

        <!-- Preflight panel -->
        <div v-if="!usesPinnedScenario" class="rounded border border-base-300 bg-base-200/40 p-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">{{ t('deployment.deploy.preflight.heading') }}</h3>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              data-testid="deploy-run-preflight"
              :disabled="preflightRunning || hardErrors.length > 0"
              @click="runPreflight"
            >
              <span v-if="preflightRunning">{{ t('deployment.deploy.preflight.running') }}</span>
              <span v-else>{{ t('deployment.deploy.preflight.run') }}</span>
            </button>
          </div>
          <p class="text-xs text-base-content/70 mt-2">{{ t('deployment.deploy.preflight.description') }}</p>
          <p v-if="preflightError" class="text-xs text-error mt-2">{{ preflightError }}</p>
          <div v-if="preflightRecord" class="mt-2 space-y-1 text-xs">
            <div v-if="preflightBlocking" class="text-error font-medium" data-testid="deploy-preflight-block">
              {{ t('deployment.deploy.preflight.blocking') }}
            </div>
            <ul v-if="preflightRecord.errors?.length" class="space-y-1 text-error">
              <li v-for="(error, index) in preflightRecord.errors" :key="index">
                <span class="font-mono">{{ error.field }}</span>: {{ error.reason }}
              </li>
            </ul>
            <ul v-if="preflightRecord.checks?.length" class="space-y-1">
              <li
                v-for="(c, i) in preflightRecord.checks"
                :key="i"
                class="flex items-start gap-2"
              >
                <span
                  class="badge badge-xs"
                  :class="c.result === 'pass' ? 'badge-success' : c.result === 'warn' ? 'badge-warning' : 'badge-error'"
                >{{ c.result }}</span>
                <span class="flex-1">
                  <span class="font-mono">{{ c.check }}</span>
                  <span v-if="c.detail" class="block text-base-content/70">{{ c.detail }}</span>
                </span>
              </li>
            </ul>
            <div v-if="preflightWarns.length > 0" data-testid="deploy-preflight-warn">
              <label class="label cursor-pointer justify-start gap-2" data-testid="deploy-warn-ack">
                <input v-model="warnAck" type="checkbox" class="checkbox checkbox-sm" />
                <span class="text-xs">{{ t('deployment.deploy.preflight.acknowledge') }}</span>
              </label>
            </div>
          </div>
        </div>

        <p v-else class="text-sm text-base-content/70">{{ t('deployment.deploy.pinnedPreflight') }}</p>

        <p v-if="submitError" role="alert" class="text-xs text-error">{{ submitError }}</p>
      </fieldset>

      <div class="modal-action mt-4">
        <button type="button" class="btn btn-sm btn-ghost" @click="onCancel">{{ t('common.cancel') }}</button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-testid="deploy-submit"
          :disabled="!canSubmit"
          @click="submit"
        >
          <span v-if="submitting">{{ t('deployment.deploy.submitting') }}</span>
          <span v-else>{{ t('deployment.deploy.submit') }}</span>
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-base-300/80" aria-hidden="true" @click="onCancel"></div>
  </div>
</template>

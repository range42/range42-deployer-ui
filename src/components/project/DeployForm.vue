<script setup>
/**
 * <DeployForm> — Plan C §C4.6
 *
 * Single-step modal that collects deployment parameters, runs preflight
 * inline against the backend, and then POSTs /v1/deployments.
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
 *       team_count, catalog_sha, project_sha, secrets: { vault_password } }
 *   team_count is required by the backend, so non-gamenet deploys send 1.
 *   The vault password goes in `secrets`; the backend writes it to
 *   <workspace>/secrets/vault_pass.txt, which the deploy run reads.
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
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectId: { type: String, default: '' },
  projectName: { type: String, default: '' },
  gamenet: { type: Boolean, default: true },
  catalogSha: { type: String, default: '' },
  projectSha: { type: String, default: '' },
  existingCodenames: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'created'])
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })

// ---------- form state ----------
const codename = ref('')
const scenarioLabel = ref('')
const targetHost = ref('')
const teamCount = ref(1)
const vaultPassword = ref('')
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
const CODENAME_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

const errCodename = computed(() => {
  const v = (codename.value || '').trim()
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
  if (!targetHost.value) return t('deployment.deploy.err.hostRequired')
  return null
})

const errTeamCount = computed(() => {
  if (!props.gamenet) return null
  const n = Number(teamCount.value)
  if (!Number.isFinite(n) || Number.isNaN(n)) return t('deployment.deploy.err.teamCountNaN')
  if (n < 1) return t('deployment.deploy.err.teamCountMin')
  return null
})

const errVault = computed(() => {
  if (!vaultPassword.value) return t('deployment.deploy.err.vaultRequired')
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
  if (r.blocking === true) return true
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
  if (preflightBlocking.value) return false
  if (preflightWarns.value.length > 0 && !warnAck.value) return false
  return !submitting.value
})

// ---------- load hosts ----------
async function loadHosts() {
  hostsLoading.value = true
  hostsError.value = null
  try {
    const res = await fetch('/v1/proxmox/hosts', { credentials: 'same-origin' })
    if (!res.ok) {
      hostsError.value = `HTTP ${res.status}`
      return
    }
    const body = await res.json()
    hosts.value = Array.isArray(body) ? body : (body?.hosts || [])
  } catch (err) {
    hostsError.value = err?.message || String(err)
  } finally {
    hostsLoading.value = false
  }
}

// ---------- preflight ----------
async function runPreflight() {
  if (hardErrors.value.length > 0) return
  preflightRunning.value = true
  preflightError.value = null
  try {
    const res = await fetch(
      `/v1/projects/${encodeURIComponent(props.projectId)}/validate`,
      {
        method: 'POST',
        credentials: 'same-origin',
        // No body: /validate checks the project's stored base + overlay
        // documents against the schema. It declares no request model, so the
        // form values we used to send here were silently discarded.
        headers: { 'Content-Type': 'application/json' },
      },
    )
    if (!res.ok) {
      preflightError.value = `HTTP ${res.status}`
      return
    }
    preflightRecord.value = await res.json()
    warnAck.value = false // reset; user must re-ack if warns reappear
  } catch (err) {
    preflightError.value = err?.message || String(err)
  } finally {
    preflightRunning.value = false
  }
}

function onBlurTriggerPreflight() {
  // Only auto-run on blur if hard errors are clear — avoids noisy backend calls.
  if (hardErrors.value.length === 0) runPreflight()
}

// ---------- submit ----------
async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = null
  try {
    const body = {
      project_id: props.projectId,
      codename: codename.value.trim(),
      scenario_label: scenarioLabel.value.trim(),
      target_host_id: targetHost.value,
      catalog_sha: props.catalogSha,
      project_sha: props.projectSha,
      // Required by DeploymentCreate; a non-gamenet lab is a single team.
      team_count: props.gamenet ? Number(teamCount.value) : 1,
      secrets: { vault_password: vaultPassword.value },
    }
    const res = await fetch('/v1/deployments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      submitError.value = `HTTP ${res.status}`
      return
    }
    const created = await res.json()
    emit('created', created?.id)
    emit('close')
    if (created?.id) {
      router.push({ name: 'deployment-detail', params: { id: created.id } })
    }
  } catch (err) {
    submitError.value = err?.message || String(err)
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  emit('close')
}

onMounted(() => {
  if (props.visible) loadHosts()
})

watch(() => props.visible, (v) => {
  if (v) {
    // Reset when re-opened so no stale state leaks across sessions.
    preflightRecord.value = null
    preflightError.value = null
    submitError.value = null
    warnAck.value = false
    loadHosts()
  }
})
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

      <div class="space-y-3">
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
            @blur="onBlurTriggerPreflight"
          >
            <option value="" disabled>{{ t('deployment.deploy.fields.hostPlaceholder') }}</option>
            <option v-for="h in hosts" :key="h.id" :value="h.id">
              {{ h.name || h.id }} <span v-if="h.node_name">({{ h.node_name }})</span>
            </option>
          </select>
          <p v-if="hostsError" class="text-xs text-warning mt-1">{{ hostsError }}</p>
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
            class="input input-bordered input-sm"
            @blur="onBlurTriggerPreflight"
          />
          <p v-if="errTeamCount" class="text-xs text-error mt-1">{{ errTeamCount }}</p>
        </div>

        <!-- Vault password -->
        <div class="form-control" data-testid="deploy-field-vault">
          <label class="label pb-1">
            <span class="label-text font-medium">{{ t('deployment.deploy.fields.vault') }}<span class="text-error ml-0.5">*</span></span>
          </label>
          <input
            v-model="vaultPassword"
            type="password"
            class="input input-bordered input-sm"
            autocomplete="new-password"
          />
          <p v-if="errVault" class="text-xs text-error mt-1">{{ errVault }}</p>
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
        <div class="rounded border border-base-300 bg-base-200/40 p-3">
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
          <p v-if="preflightError" class="text-xs text-error mt-2">{{ preflightError }}</p>
          <div v-if="preflightRecord" class="mt-2 space-y-1 text-xs">
            <div v-if="preflightBlocking" class="text-error font-medium" data-testid="deploy-preflight-block">
              {{ t('deployment.deploy.preflight.blocking') }}
            </div>
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

        <p v-if="submitError" class="text-xs text-error">{{ submitError }}</p>
      </div>

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

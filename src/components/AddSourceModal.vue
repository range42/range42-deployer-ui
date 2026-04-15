<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { detectProviderFromUrl, getProvider } from '@/services/git'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'submit'])

const { t } = useI18n()

const activeTab = ref('paste')

// Paste URL tab state
const pasteUrl = ref('')
const pasteError = ref('')
const pasteInfo = ref('')
const pasteBusy = ref(false)

// OAuth tab state (PKCE out of scope — PAT fallback)
const oauthProvider = ref('github')

// Self-hosted tab state
const selfUrl = ref('')
const selfProvider = ref('gitea')
const selfToken = ref('')
const selfTestMsg = ref('')
const selfTestStatus = ref('') // 'ok' | 'down' | ''
const selfTestBusy = ref(false)

function reset() {
  activeTab.value = 'paste'
  pasteUrl.value = ''
  pasteError.value = ''
  pasteInfo.value = ''
  selfUrl.value = ''
  selfProvider.value = 'gitea'
  selfToken.value = ''
  selfTestMsg.value = ''
  selfTestStatus.value = ''
}

function close() {
  reset()
  emit('close')
}

function genId() {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `src-${Date.now().toString(36)}-${rnd}`
}

function providerBaseUrl(kind, url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    if (kind === 'github') return 'https://github.com'
    return url
  }
}

async function submitPaste() {
  pasteError.value = ''
  pasteInfo.value = ''
  if (!pasteUrl.value.trim()) {
    pasteError.value = t('sources.paste_url_required')
    return
  }
  pasteBusy.value = true
  try {
    const detected = detectProviderFromUrl(pasteUrl.value) || 'generic'
    const id = genId()
    const source = {
      id,
      provider: detected,
      base_url: providerBaseUrl(detected, pasteUrl.value),
      auth: { kind: 'none' },
      repos: [],
      name: pasteUrl.value,
    }
    emit('submit', { source, token: '' })
    close()
  } catch (err) {
    pasteError.value = err?.message || String(err)
  } finally {
    pasteBusy.value = false
  }
}

function submitOauth() {
  // OAuth PKCE flow is out of scope for this task. Fall back to PAT via self-hosted tab.
  activeTab.value = 'self'
}

async function testSelfHosted() {
  selfTestMsg.value = ''
  selfTestStatus.value = ''
  selfTestBusy.value = true
  try {
    if (!selfUrl.value.trim()) {
      selfTestStatus.value = 'down'
      selfTestMsg.value = t('sources.url_required')
      return
    }
    const prov = getProvider(selfProvider.value, {
      baseUrl: selfUrl.value,
      token: selfToken.value || null,
    })
    const h = await prov.health()
    if (h.ok) {
      selfTestStatus.value = 'ok'
      selfTestMsg.value = t('sources.connected_ok', { rtt: Math.round(h.rtt_ms) })
    } else {
      selfTestStatus.value = 'down'
      selfTestMsg.value = t('sources.connection_failed')
    }
  } catch (err) {
    selfTestStatus.value = 'down'
    selfTestMsg.value = err?.message || String(err)
  } finally {
    selfTestBusy.value = false
  }
}

function submitSelfHosted() {
  if (!selfUrl.value.trim()) {
    selfTestStatus.value = 'down'
    selfTestMsg.value = t('sources.url_required')
    return
  }
  const id = genId()
  const source = {
    id,
    provider: selfProvider.value,
    base_url: selfUrl.value,
    auth: selfToken.value
      ? { kind: 'pat', ref_to_token_id: id }
      : { kind: 'none' },
    repos: [],
    name: selfUrl.value,
  }
  emit('submit', { source, token: selfToken.value })
  close()
}

const visible = computed(() => props.open)
</script>

<template>
  <div v-if="visible" class="modal modal-open" role="dialog" aria-modal="true">
    <div class="modal-box max-w-xl">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4"
        :aria-label="t('common.close')"
        @click="close"
      >
        ✕
      </button>
      <h3 class="text-xl font-bold mb-2">{{ t('sources.add') }}</h3>
      <p class="text-sm text-base-content/70 mb-4">
        {{ t('sources.add_hint') }}
      </p>

      <div role="tablist" class="tabs tabs-boxed mb-4">
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'paste' }"
          @click="activeTab = 'paste'"
        >
          {{ t('sources.paste_url') }}
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'oauth' }"
          @click="activeTab = 'oauth'"
        >
          {{ t('sources.oauth_tree') }}
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': activeTab === 'self' }"
          @click="activeTab = 'self'"
        >
          {{ t('sources.self_hosted') }}
        </button>
      </div>

      <!-- Paste URL tab -->
      <section v-if="activeTab === 'paste'" class="space-y-3">
        <label class="form-control">
          <span class="label label-text">{{ t('sources.repo_url_label') }}</span>
          <input
            v-model="pasteUrl"
            type="text"
            class="input input-bordered"
            placeholder="https://github.com/acme/lab"
          />
        </label>
        <p v-if="pasteError" class="text-error text-sm">{{ pasteError }}</p>
        <p v-if="pasteInfo" class="text-success text-sm">{{ pasteInfo }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="close">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="pasteBusy"
            @click="submitPaste"
          >
            {{ t('common.add') }}
          </button>
        </div>
      </section>

      <!-- OAuth tab -->
      <section v-if="activeTab === 'oauth'" class="space-y-3">
        <label class="form-control">
          <span class="label label-text">{{ t('sources.provider_label') }}</span>
          <select v-model="oauthProvider" class="select select-bordered">
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="gitea">Gitea</option>
          </select>
        </label>
        <div class="alert alert-info text-sm">
          {{ t('sources.oauth_out_of_scope') }}
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="close">{{ t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" @click="submitOauth">
            {{ t('sources.switch_to_pat') }}
          </button>
        </div>
      </section>

      <!-- Self-hosted tab -->
      <section v-if="activeTab === 'self'" class="space-y-3">
        <label class="form-control">
          <span class="label label-text">{{ t('sources.provider_label') }}</span>
          <select v-model="selfProvider" class="select select-bordered">
            <option value="gitlab">GitLab</option>
            <option value="gitea">Gitea</option>
            <option value="github">GitHub</option>
            <option value="generic">{{ t('sources.generic') }}</option>
          </select>
        </label>
        <label class="form-control">
          <span class="label label-text">{{ t('sources.base_url_label') }}</span>
          <input
            v-model="selfUrl"
            type="text"
            class="input input-bordered"
            placeholder="https://gitea.example.com"
          />
        </label>
        <label class="form-control">
          <span class="label label-text">{{ t('sources.token_label') }}</span>
          <input
            v-model="selfToken"
            type="password"
            class="input input-bordered"
            autocomplete="new-password"
          />
        </label>
        <p
          v-if="selfTestMsg"
          class="text-sm"
          :class="{
            'text-success': selfTestStatus === 'ok',
            'text-error': selfTestStatus === 'down',
          }"
        >
          {{ selfTestMsg }}
        </p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="close">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="selfTestBusy"
            @click="testSelfHosted"
          >
            {{ t('sources.test_connection') }}
          </button>
          <button type="button" class="btn btn-primary" @click="submitSelfHosted">
            {{ t('common.add') }}
          </button>
        </div>
      </section>
    </div>
    <div class="modal-backdrop" @click="close" />
  </div>
</template>

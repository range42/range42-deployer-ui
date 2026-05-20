<script setup>
defineOptions({ name: 'SourcesView' })

import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInventoryStore } from '@/stores/inventoryStore'
import { getProvider } from '@/services/git'
import SourceHealthRow from '@/components/ui/SourceHealthRow.vue'
import AddSourceModal from '@/components/AddSourceModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { ensureNamespaces } from '@/i18n'

const { t } = useI18n()
const inv = useInventoryStore()

const addModalOpen = ref(false)
const rotatingId = ref(null)
const rotateToken = ref('')

onMounted(async () => {
  await ensureNamespaces(['sources', 'common'])
  // Best-effort sync with backend — non-fatal.
  try {
    const res = await fetch('/v1/catalog/sources', { credentials: 'same-origin' })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.sources)) {
        for (const s of data.sources) {
          if (!inv.getSource(s.id)) {
            try {
              inv.addSource(s)
            } catch {
              /* ignore duplicates */
            }
          }
        }
      }
    }
  } catch {
    /* backend may not exist in dev — ignore */
  }
})

function handleAdd(payload) {
  try {
    inv.addSource(payload.source)
    if (payload.token) {
      inv.setToken(payload.source.id, payload.token)
    }
    // Kick off an initial health check in background
    runHealth(payload.source.id)
  } catch (err) {
    console.error('[Sources] addSource failed:', err)
  }
}

async function runHealth(id) {
  const s = inv.getSource(id)
  if (!s) return
  inv.updateSourceHealth(id, { status: 'unknown', checked_at: new Date().toISOString() })
  // Try backend refresh first; fall back to local provider probe.
  try {
    const res = await fetch(`/v1/catalog/sources/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (res.ok) {
      const data = await res.json()
      inv.updateSourceHealth(id, {
        status: data.status || 'ok',
        rtt_ms: data.rtt_ms,
        checked_at: new Date().toISOString(),
      })
      return
    }
  } catch {
    /* backend unreachable — fall through */
  }
  try {
    const prov = getProvider(s.provider, {
      baseUrl: s.base_url,
      token: inv.getToken(id),
    })
    const h = await prov.health()
    inv.updateSourceHealth(id, {
      status: h.ok ? 'ok' : 'down',
      rtt_ms: h.rtt_ms,
      checked_at: new Date().toISOString(),
    })
  } catch (err) {
    inv.updateSourceHealth(id, {
      status: 'down',
      checked_at: new Date().toISOString(),
      error: err?.message || String(err),
    })
  }
}

function handleRemove(source) {
  if (!source) return
  inv.removeSource(source.id)
}

function openRotate(source) {
  rotatingId.value = source.id
  rotateToken.value = ''
}

function submitRotate() {
  if (rotatingId.value && rotateToken.value) {
    inv.setToken(rotatingId.value, rotateToken.value)
  }
  rotatingId.value = null
  rotateToken.value = ''
}

function cancelRotate() {
  rotatingId.value = null
  rotateToken.value = ''
}
</script>

<template>
  <section class="max-w-4xl mx-auto p-6">
    <header class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('sources.title') }}</h1>
        <p class="text-sm text-base-content/70 mt-1">{{ t('sources.subtitle') }}</p>
      </div>
      <button type="button" class="btn btn-primary" @click="addModalOpen = true">
        {{ t('sources.add') }}
      </button>
    </header>

    <div v-if="inv.sources.length === 0">
      <EmptyState
        :title="t('sources.empty_title')"
        :description="t('sources.empty_desc')"
      >
        <template #actions>
          <button class="btn btn-primary" @click="addModalOpen = true">
            {{ t('sources.add') }}
          </button>
        </template>
      </EmptyState>
    </div>

    <ul v-else class="space-y-2" data-testid="sources-list">
      <li v-for="s in inv.sources" :key="s.id">
        <SourceHealthRow
          :source="s"
          :health="s.health || { status: 'unknown' }"
          @test="runHealth(s.id)"
          @remove="handleRemove"
          @rotate-token="openRotate"
        />
      </li>
    </ul>

    <AddSourceModal :open="addModalOpen" @close="addModalOpen = false" @submit="handleAdd" />

    <!-- Rotate token mini-modal -->
    <div v-if="rotatingId" class="modal modal-open" role="dialog" aria-modal="true">
      <div class="modal-box max-w-sm">
        <h3 class="font-bold text-lg">{{ t('sources.rotate_token') }}</h3>
        <p class="text-sm text-base-content/70 mt-2 mb-3">{{ t('sources.rotate_hint') }}</p>
        <input
          v-model="rotateToken"
          type="password"
          class="input input-bordered w-full"
          autocomplete="new-password"
        />
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="cancelRotate">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!rotateToken"
            @click="submitRotate"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="cancelRotate" />
    </div>
  </section>
</template>

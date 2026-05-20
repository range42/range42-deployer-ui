<script setup>
import { computed, ref } from 'vue'
import {
  LEGACY_RENAMED_KEY,
  discardLegacyStorage,
  shouldShowLegacyBanner,
} from '@/services/projectRepo/migration.ts'

// Ref-backed so discardLegacyStorage() triggers re-render
const tick = ref(0)
const visible = computed(() => {
  // `tick` read so Vue tracks; underlying check reads localStorage
  void tick.value
  return shouldShowLegacyBanner()
})

const legacyCount = computed(() => {
  void tick.value
  try {
    const raw = localStorage.getItem(LEGACY_RENAMED_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
})

function openLegacy() {
  // Minimal action: reveal legacy JSON via download so the user can inspect
  // their pre-migration data if needed.
  const raw = localStorage.getItem(LEGACY_RENAMED_KEY) || '[]'
  const blob = new Blob([raw], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'range42_projects_legacy.json'
  a.click()
  URL.revokeObjectURL(url)
}

function onDiscard() {
  if (!confirm('Discard the legacy local project backup now?')) return
  discardLegacyStorage()
  tick.value++
}
</script>

<template>
  <div
    v-if="visible"
    data-testid="legacy-storage-banner"
    role="status"
    class="alert alert-info rounded-none border-b border-base-300 shadow-none"
  >
    <span class="flex-1 text-sm">
      Local project backup still available ({{ legacyCount }} project{{ legacyCount === 1 ? '' : 's' }})
      for 30 days after migration.
    </span>
    <button class="btn btn-ghost btn-sm" type="button" @click="openLegacy">
      Open legacy data
    </button>
    <button class="btn btn-ghost btn-sm text-error" type="button" @click="onDiscard">
      Discard now
    </button>
  </div>
</template>

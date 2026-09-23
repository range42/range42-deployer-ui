<script setup>
import { computed } from 'vue'

const props = defineProps({ checks: { type: Object, default: null } })
const labels = {
  sqlite_wal: ['Database', 'Check the backend database configuration and write permissions.'],
  workspace_writable: ['Workspace storage', 'Check the backend workspace location and write permissions.'],
  proxmox: ['Proxmox access', 'Check the registered Proxmox host credentials, certificate and connection.'],
  git: ['Git repositories', 'Repository access is checked when syncing or publishing.'],
}

const rows = computed(() => Object.entries(labels).flatMap(([key, [label, help]]) => {
  const check = props.checks?.[key]
  if (!check || typeof check !== 'object') return []
  // Older APIs returned ok:true for a source count without checking Git access.
  const status = key === 'git' || check.ok == null ? 'Not checked' : check.ok === true ? 'Passed' : 'Failed'
  const count = check.sources_registered
  const description = key === 'git'
    ? `${Number.isInteger(count) && count >= 0 ? `${count} source${count === 1 ? '' : 's'} registered. ` : ''}${help}`
    : status === 'Failed' ? help : ''
  return [{ key, label, status, description }]
}))
</script>

<template>
  <dl v-if="rows.length" class="text-xs space-y-2 min-w-0" aria-live="polite" aria-label="Backend readiness checks">
    <div v-for="row in rows" :key="row.key" :data-testid="`readiness-${row.key}`">
      <div class="flex flex-wrap items-center gap-2">
        <dt>{{ row.label }}</dt>
        <dd class="badge badge-sm" :class="row.status === 'Passed' ? 'badge-success' : row.status === 'Failed' ? 'badge-error' : 'badge-ghost'">
          {{ row.status }}
        </dd>
      </div>
      <dd v-if="row.description" class="mt-1 text-base-content/80 break-words">{{ row.description }}</dd>
    </div>
  </dl>
</template>

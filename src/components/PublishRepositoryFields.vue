<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { GitSource } from '@/stores/inventoryStore'

interface RepositoryFields {
  source_id: string
  repo_owner: string
  repo_name: string
  base_branch: string
  subdir?: string
}
const props = defineProps<{ modelValue: RepositoryFields; sources: GitSource[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: RepositoryFields] }>()
const { t } = useI18n()

function update(field: keyof RepositoryFields, event: Event) {
  const value = (event.target as HTMLInputElement).value
  const next = { ...props.modelValue, [field]: value }
  if (field === 'source_id') {
    const repo = props.sources.find((source) => source.id === value)?.repos?.[0]
    next.repo_owner = repo?.owner ?? ''
    next.repo_name = repo?.repo ?? ''
    next.base_branch = repo?.branch ?? 'main'
  }
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label class="block sm:col-span-2">
      <span class="label text-sm">{{ t('publishing.source') }}</span>
      <select :value="modelValue.source_id" :disabled="disabled" class="select select-bordered w-full"
        data-testid="repository-source" @change="update('source_id', $event)">
        <option value="">{{ t('publishing.choose_source') }}</option>
        <option v-for="source in sources" :key="source.id" :value="source.id">
          {{ source.name || source.base_url }} · {{ source.provider }}
        </option>
      </select>
    </label>
    <label class="block">
      <span class="label text-sm">{{ t('publishing.owner') }}</span>
      <input :value="modelValue.repo_owner" :disabled="disabled" class="input input-bordered w-full"
        data-testid="repository-owner" autocomplete="off" @input="update('repo_owner', $event)" />
    </label>
    <label class="block">
      <span class="label text-sm">{{ t('publishing.repository') }}</span>
      <input :value="modelValue.repo_name" :disabled="disabled" class="input input-bordered w-full"
        data-testid="repository-name" autocomplete="off" @input="update('repo_name', $event)" />
    </label>
    <label class="block">
      <span class="label text-sm">{{ t('publishing.target_branch') }}</span>
      <input :value="modelValue.base_branch" :disabled="disabled" class="input input-bordered w-full"
        data-testid="repository-branch" autocomplete="off" @input="update('base_branch', $event)" />
    </label>
    <label class="block">
      <span class="label text-sm">{{ t('publishing.subdir') }}</span>
      <input :value="modelValue.subdir" :disabled="disabled" class="input input-bordered w-full"
        data-testid="repository-subdir" :placeholder="t('publishing.root_directory')"
        autocomplete="off" @input="update('subdir', $event)" />
    </label>
  </div>
</template>

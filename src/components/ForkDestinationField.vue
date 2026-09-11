<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const destination = defineModel<string>({ default: '' })
defineProps<{ disabled?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <label class="block">
    <span class="label text-sm">{{ t('publishing.fork_owner') }}</span>
    <input v-model="destination" class="input input-bordered w-full" data-testid="fork-destination" autocomplete="off" :disabled="disabled" />
    <span class="text-xs text-base-content/70 block mt-2">{{ t('publishing.fork_owner_hint') }}</span>
  </label>
</template>

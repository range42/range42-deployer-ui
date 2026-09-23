<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import FormField from '@/components/ui/FormField.vue'
import FormSection from '@/components/ui/FormSection.vue'

const config = defineModel<{ text?: string; color?: string }>({ required: true })
const { t } = useI18n()
</script>

<template>
  <FormSection variant="bordered" :columns="1">
    <FormField v-model="config.text" :label="t('configPanel.note.text')" type="textarea" :rows="8" icon="" />
    <FormField v-model="config.color" :label="t('configPanel.note.color')" type="select" icon=""
      :options="['yellow', 'blue', 'green', 'neutral'].map(value => ({ value, label: t(`configPanel.note.colors.${value}`) }))" />
    <p class="text-sm text-base-content/70">{{ t('configPanel.note.hint') }}</p>
  </FormSection>
</template>

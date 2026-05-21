<script setup>
import { useI18n } from 'vue-i18n'

const props = defineProps({
  source: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['update:source'])

const { t } = useI18n()

function onInput(event) {
  emit('update:source', { ...props.source, content_inline: event.target.value })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <label class="label text-sm font-medium">
      {{ t('project.attachments.inline.label') }}
    </label>
    <textarea
      data-testid="inline-yaml"
      class="textarea textarea-bordered font-mono w-full"
      :value="source.content_inline ?? ''"
      @input="onInput"
    />
  </div>
</template>

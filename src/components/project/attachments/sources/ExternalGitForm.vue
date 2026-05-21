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

function onFieldInput(field, event) {
  emit('update:source', { ...props.source, [field]: event.target.value })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <label class="label text-sm font-medium">
        {{ t('project.attachments.git.url_label') }}
      </label>
      <input
        data-testid="git-url"
        type="text"
        class="input input-bordered w-full"
        :value="source.url ?? ''"
        @input="onFieldInput('url', $event)"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label class="label text-sm font-medium">
        {{ t('project.attachments.git.sha_label') }}
      </label>
      <input
        data-testid="git-sha"
        type="text"
        class="input input-bordered w-full font-mono"
        :value="source.sha ?? ''"
        @input="onFieldInput('sha', $event)"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label class="label text-sm font-medium">
        {{ t('project.attachments.git.ref_label') }}
      </label>
      <input
        data-testid="git-ref"
        type="text"
        class="input input-bordered w-full font-mono"
        :value="source.ref ?? ''"
        @input="onFieldInput('ref', $event)"
      />
    </div>

    <div
      data-testid="git-security-note"
      class="alert alert-warning text-sm"
    >
      {{ t('project.attachments.git.security_note') }}
    </div>
  </div>
</template>

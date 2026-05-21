<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const MAX_SIZE = 262144 // 256 KB

const props = defineProps({
  source: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['update:source'])

const { t } = useI18n()

const fileMeta = ref(null)
const fileError = ref(false)

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      // Strip "data:<mime>;base64," prefix
      const base64 = e.target.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  if (file.size > MAX_SIZE) {
    fileError.value = true
    fileMeta.value = null
    return
  }

  fileError.value = false
  fileMeta.value = { name: file.name, size: file.size }

  const base64 = await readFileAsBase64(file)
  emit('update:source', { ...props.source, content_inline: base64 })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <label class="label text-sm font-medium">
      {{ t('project.attachments.file.label') }}
    </label>

    <input
      data-testid="file-input"
      type="file"
      class="file-input file-input-bordered w-full"
      @change="onFileChange"
    />

    <div
      v-if="fileMeta"
      data-testid="file-meta"
      class="text-sm text-base-content/70"
    >
      {{ fileMeta.name }} ({{ fileMeta.size }} bytes)
    </div>

    <div
      v-if="fileError"
      data-testid="file-error"
      class="alert alert-error text-sm"
    >
      {{ t('project.attachments.file.size_error') }}
    </div>
  </div>
</template>

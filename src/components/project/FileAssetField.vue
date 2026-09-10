<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { assetFromBytes, isBinaryFile, MAX_FILE_BYTES, validateFilePath } from '@/services/projectFiles'

const props = defineProps({ modelValue: { type: [String, Object], required: true }, filename: { type: String, default: 'asset.bin' }, readonly: Boolean })
const emit = defineEmits(['update:modelValue', 'uploaded'])
const error = ref('')
const loading = ref(false)
let request = 0
const binary = computed(() => isBinaryFile(props.modelValue) ? props.modelValue : null)
onBeforeUnmount(() => { request += 1 })

async function upload(event) {
  const file = event.target.files?.[0]
  if (!file) return
  const current = ++request
  error.value = ''
  try {
    validateFilePath(file.name)
    if (file.size > MAX_FILE_BYTES) throw new Error('The 1 MiB per-file limit was exceeded. Choose a smaller file.')
    loading.value = true
    const buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('The file could not be read. Choose it again.'))
      reader.readAsArrayBuffer(file)
    })
    if (current !== request) return
    const asset = assetFromBytes(new Uint8Array(buffer), file.type || 'application/octet-stream')
    emit('update:modelValue', asset)
    emit('uploaded', { filename: file.name })
  } catch (reason) { if (current === request) error.value = reason.message || String(reason) }
  finally { if (current === request) loading.value = false; event.target.value = '' }
}
</script>

<template>
  <div class="space-y-2 min-w-0" data-testid="file-asset-field">
    <p v-if="binary" class="text-sm break-words" data-testid="asset-metadata">Binary file · {{ binary.size }} bytes · {{ binary.media_type || 'application/octet-stream' }}</p>
    <a v-if="binary" :href="`data:application/octet-stream;base64,${binary.content}`" :download="filename" class="btn btn-outline btn-sm" data-testid="asset-download">Download file</a>
    <label v-if="!readonly" class="form-control gap-1 block">
      <span class="text-sm">{{ binary ? 'Replace uploaded file' : 'Upload a file (preserves its original bytes)' }}</span>
      <input type="file" class="file-input file-input-bordered w-full" :disabled="loading" @change="upload" />
    </label>
    <p class="text-xs text-base-content/70">Initial browser storage limits: 1 MiB per file, 2 MiB total project files. Uploads are saved with the project and published as real Git files.</p>
    <p v-if="loading" class="text-sm" role="status">Reading file…</p>
    <p v-if="error" class="alert alert-error text-sm" role="alert">{{ error }}</p>
  </div>
</template>

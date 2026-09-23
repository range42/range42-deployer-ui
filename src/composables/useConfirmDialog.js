import { ref } from 'vue'

const visible = ref(false)
const title = ref('')
const message = ref('')
const confirmText = ref('Confirm')
const cancelText = ref('Cancel')
const confirmClass = ref('btn-primary')

let _resolve = null

function confirm(options = {}) {
  if (_resolve) _resolve(false)
  title.value = options.title || 'Confirm'
  message.value = options.message || 'Are you sure?'
  confirmText.value = options.confirmText || 'Confirm'
  cancelText.value = options.cancelText || 'Cancel'
  confirmClass.value = options.confirmClass || 'btn-primary'
  visible.value = true

  return new Promise((resolve) => {
    _resolve = resolve
  })
}

function resolve(value) {
  visible.value = false
  if (_resolve) {
    _resolve(value)
    _resolve = null
  }
}

export function useConfirmDialog() {
  return {
    visible,
    title,
    message,
    confirmText,
    cancelText,
    confirmClass,
    confirm,
    resolve,
  }
}

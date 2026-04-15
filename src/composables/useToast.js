import { ref } from 'vue'

let _id = 0
const toasts = ref([])

function showToast(message, type = 'info', duration = 4000) {
  if (toasts.value.length >= 5) toasts.value.shift()
  const id = ++_id
  toasts.value.push({ id, message, type })

  if (duration > 0) {
    setTimeout(() => {
      removeToast(id)
    }, duration)
  }
}

function removeToast(id) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

export function useToast() {
  return {
    toasts,
    showToast,
    removeToast,
  }
}

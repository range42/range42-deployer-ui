import { ref } from 'vue'

let _id = 0
const toasts = ref([])
// Pause/resume metadata — keyed by toast id.
const _timers = new Map() // id -> { timeoutId, remaining, duration, startedAt }

function _scheduleDismissal(id, duration) {
  if (duration <= 0) return
  const startedAt = Date.now()
  const timeoutId = setTimeout(() => removeToast(id), duration)
  _timers.set(id, { timeoutId, remaining: duration, duration, startedAt })
}

function pauseToast(id) {
  const t = _timers.get(id)
  if (!t) return
  clearTimeout(t.timeoutId)
  const elapsed = Date.now() - t.startedAt
  t.remaining = Math.max(0, t.remaining - elapsed)
  t.timeoutId = null
  _timers.set(id, t)
}

function resumeToast(id) {
  const t = _timers.get(id)
  if (!t || t.timeoutId) return
  t.startedAt = Date.now()
  t.timeoutId = setTimeout(() => removeToast(id), t.remaining)
  _timers.set(id, t)
}

function showToast(message, type = 'info', duration = 4000) {
  if (toasts.value.length >= 5) toasts.value.shift()
  const id = ++_id
  toasts.value.push({ id, message, type })
  _scheduleDismissal(id, duration)
}

function removeToast(id) {
  toasts.value = toasts.value.filter(t => t.id !== id)
  const t = _timers.get(id)
  if (t?.timeoutId) clearTimeout(t.timeoutId)
  _timers.delete(id)
}

export function useToast() {
  return {
    toasts,
    showToast,
    removeToast,
    pauseToast,
    resumeToast,
  }
}

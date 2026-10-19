import { nextTick, onBeforeUnmount, toValue, watch } from 'vue'

function controls(root) {
  return [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter(element => {
    if (element.matches(':disabled, [tabindex="-1"], input[type="hidden"]')) return false
    for (let parent = element; parent && root.contains(parent); parent = parent.parentElement) {
      const style = getComputedStyle(parent)
      if (parent.hidden || parent.hasAttribute('inert') || style.display === 'none' || style.visibility === 'hidden') return false
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector('summary')?.contains(element)) return false
    }
    return true
  })
}

/** Keep modal keyboard navigation local and return focus to its opener. */
export function useDialogKeyboard(open, container, close) {
  let opener = null
  function restore() {
    const previous = opener
    opener = null
    void nextTick(() => { if (previous?.isConnected) previous.focus() })
  }
  watch(open, async (visible, wasVisible) => {
    if (visible && !wasVisible) {
      opener = document.activeElement
      await nextTick()
      if (toValue(open) && container.value) controls(container.value)[0]?.focus()
    } else if (!visible && wasVisible) restore()
  }, { immediate: true })
  onBeforeUnmount(restore)
  return function onDialogKeydown(event) {
    if (event.defaultPrevented) return
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || !container.value) return
    const elements = controls(container.value)
    const first = elements[0]
    const last = elements.at(-1)
    if (!first) { event.preventDefault(); container.value.focus(); return }
    if (!container.value.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus()
    }
  }
}

import { expect, it, vi } from 'vitest'
import { focusWhenReady } from '@/composables/useDialogKeyboard'

it('preserves a human focus choice inside the dialog while its initial focus retry is pending', () => {
  const root = document.createElement('div')
  root.setAttribute('role', 'dialog')
  root.innerHTML = '<input><button>Cancel</button>'
  document.body.append(root)
  const input = root.querySelector('input'), cancel = root.querySelector('button')
  const frames = []
  vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const focus = vi.spyOn(input, 'focus').mockImplementationOnce(() => {})
  let stop = () => {}
  try {
    stop = focusWhenReady(() => input, () => true)
    cancel.focus()
    frames.splice(0).forEach(callback => callback())
    expect(document.activeElement).toBe(cancel)
  } finally { stop(); focus.mockRestore(); vi.unstubAllGlobals(); root.remove() }
})

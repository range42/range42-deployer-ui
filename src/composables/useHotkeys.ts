import { onMounted, onUnmounted } from 'vue';

export type HotkeyBinding = {
  key: string;
  handler: (e: KeyboardEvent) => void;
  when?: () => boolean;
};

/**
 * Register keyboard shortcuts for the lifetime of the calling component.
 *
 * - Matches `e.key` case-insensitively against `binding.key`.
 * - Skips dispatch when the active target is an editable field (input / textarea /
 *   contenteditable) so shortcuts don't fight with typing.
 * - Calls `preventDefault()` only when a binding actually fires.
 */
export function useHotkeys(bindings: HotkeyBinding[]): void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.('input,textarea,[contenteditable=true]')) return;
    for (const b of bindings) {
      if (e.key.toLowerCase() === b.key.toLowerCase() && (!b.when || b.when())) {
        b.handler(e);
        e.preventDefault();
        return;
      }
    }
  };
  onMounted(() => window.addEventListener('keydown', onKey));
  onUnmounted(() => window.removeEventListener('keydown', onKey));
}

import { describe, it, expect, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useHotkeys } from '../composables/useHotkeys';

function makeHost(bindings) {
  return defineComponent({
    setup() {
      useHotkeys(bindings);
      return () => h('div', { tabindex: -1 }, 'host');
    },
  });
}

describe('useHotkeys', () => {
  it('fires matching handler when key pressed outside input', async () => {
    const handler = vi.fn();
    const Host = makeHost([{ key: 'v', handler }]);
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    expect(handler).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('ignores handler when event target is an input', async () => {
    const handler = vi.fn();
    const Host = makeHost([{ key: 'v', handler }]);
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const evt = new KeyboardEvent('keydown', { key: 'v', bubbles: true });
    input.dispatchEvent(evt);
    // Also dispatch from window but with target=input via bubbling
    expect(handler).not.toHaveBeenCalled();
    input.remove();
    wrapper.unmount();
  });

  it('honors the when() guard', async () => {
    const handler = vi.fn();
    let allow = false;
    const Host = makeHost([{ key: 'r', handler, when: () => allow }]);
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(handler).not.toHaveBeenCalled();

    allow = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(handler).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('unbinds on unmount', async () => {
    const handler = vi.fn();
    const Host = makeHost([{ key: 'v', handler }]);
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();
    wrapper.unmount();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    expect(handler).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ConfirmDialog from '../components/ui/ConfirmDialog.vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';

// Stub focus-trap-vue — the real library is not essential for a11y role checks
// and its internals don't work reliably in jsdom.
import { vi } from 'vitest';
vi.mock('focus-trap-vue', () => ({
  FocusTrap: {
    name: 'FocusTrapStub',
    props: ['active', 'initialFocus'],
    template: '<div><slot /></div>',
  },
}));

describe('ConfirmDialog a11y', () => {
  beforeEach(async () => {
    // Reset state between tests by resolving any lingering promise.
    const { visible, resolve } = useConfirmDialog();
    if (visible.value) resolve(false);
    await flushPromises();
  });

  it('renders role=alertdialog + aria-modal + labelledby/describedby when open', async () => {
    const { confirm } = useConfirmDialog();
    const wrapper = mount(ConfirmDialog, { attachTo: document.body, global: { stubs: { teleport: true } } });
    // Kick off the dialog; ignore the returned promise for the assertion.
    void confirm({ title: 'Delete?', message: 'sure?' });
    await flushPromises();
    const dialog = wrapper.find('[role="alertdialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBe('confirm-title');
    expect(dialog.attributes('aria-describedby')).toBe('confirm-body');
    expect(wrapper.find('#confirm-title').text()).toContain('Delete?');
    expect(wrapper.find('#confirm-body').text()).toContain('sure?');
    // Close to clean up.
    const { resolve } = useConfirmDialog();
    resolve(false);
    await flushPromises();
    wrapper.unmount();
  });

  it('Escape key resolves the dialog with false', async () => {
    const { confirm } = useConfirmDialog();
    const wrapper = mount(ConfirmDialog, { attachTo: document.body, global: { stubs: { teleport: true } } });
    const promise = confirm({ title: 'x', message: 'y' });
    await flushPromises();
    const dialog = wrapper.find('[role="alertdialog"]');
    await dialog.trigger('keydown', { key: 'Escape' });
    await flushPromises();
    const result = await promise;
    expect(result).toBe(false);
    wrapper.unmount();
  });

  it('returns focus to opener element when closed', async () => {
    const btn = document.createElement('button');
    btn.textContent = 'opener';
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);

    const { confirm, resolve } = useConfirmDialog();
    const wrapper = mount(ConfirmDialog, { attachTo: document.body, global: { stubs: { teleport: true } } });
    void confirm({ title: 't', message: 'm' });
    await flushPromises();
    resolve(false);
    await flushPromises();
    expect(document.activeElement).toBe(btn);

    document.body.removeChild(btn);
    wrapper.unmount();
  });
});

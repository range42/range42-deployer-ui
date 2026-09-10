import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AddSourceModal from '@/components/AddSourceModal.vue'
import sourcesEn from '@/locales/en/sources.json'
import commonEn from '@/locales/en/common.json'

function modal(props = {}) {
  return mount(AddSourceModal, {
    props: { open: true, ...props },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { sources: sourcesEn, common: commonEn } } })] },
  })
}

describe('repository onboarding form', () => {
  it('binds a full GitHub repository URL to a host, owner, repository and branch without a PAT', async () => {
    const wrapper = modal()
    await wrapper.find('input[type="text"]').setValue('https://github.com/range42/range42-catalog.git')
    const submit = wrapper.find('button.btn-primary')
    await submit.trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      provider: 'github', base_url: 'https://github.com', auth_kind: 'none',
      repos: [{ owner: 'range42', repo: 'range42-catalog', branch: 'main' }],
    })
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it.each([
    'not a repository',
    'https://github.com/range42',
    'https://github.com/range42/range42-catalog/tree/main',
    'https://secret:token@github.com/range42/range42-catalog',
    'https://github.com/range42/range42-catalog?access_token=secret',
  ])('rejects invalid or credential-bearing repository URL %s', async (url) => {
    const wrapper = modal()
    await wrapper.find('input[type="text"]').setValue(url)
    await wrapper.find('button.btn-primary').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('preserves a self-hosted GitLab subgroup and selected branch', async () => {
    const wrapper = modal()
    await wrapper.find('input[type="text"]').setValue('https://git.example.test/platform/catalogs/inventory.git')
    expect(wrapper.find('select').exists()).toBe(true)
    await wrapper.find('select').setValue('gitlab')
    await wrapper.find('[data-testid="source-branch"]').setValue('release/catalog')
    await wrapper.find('button.btn-primary').trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      provider: 'gitlab', base_url: 'https://git.example.test', auth_kind: 'none',
      repos: [{ owner: 'platform/catalogs', repo: 'inventory', branch: 'release/catalog' }],
    })
  })

  it.each(['@', 'release//main', 'main.lock', 'topic@{1}', 'refs/.hidden'])('rejects invalid branch %s before registering the repository', async (branch) => {
    const wrapper = modal()
    await wrapper.find('input[type="text"]').setValue('https://github.com/range42/range42-catalog')
    await wrapper.find('[data-testid="source-branch"]').setValue(branch)
    await wrapper.find('button.btn-primary').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').text()).toBe(sourcesEn.invalid_branch)
  })

  it('keeps backend errors visible inside the form and disables submission while saving', () => {
    const wrapper = modal({ busy: true, error: 'Repository already registered' })
    expect(wrapper.find('[role="alert"]').text()).toContain('Repository already registered')
    expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeDefined()
  })
})

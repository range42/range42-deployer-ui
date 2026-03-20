import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AppIcon from '@/components/icons/AppIcon.vue'

describe('AppIcon', () => {
  it('renders an svg element for a known icon', () => {
    const wrapper = mount(AppIcon, { props: { name: 'monitor' } })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 24 24')
  })

  it('passes class attribute through to svg', () => {
    const wrapper = mount(AppIcon, {
      props: { name: 'monitor' },
      attrs: { class: 'w-5 h-5' }
    })
    expect(wrapper.find('svg').classes()).toContain('w-5')
    expect(wrapper.find('svg').classes()).toContain('h-5')
  })

  it('renders nothing and warns for unknown icon name', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mount(AppIcon, { props: { name: 'nonexistent' } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'))
    spy.mockRestore()
  })

  it('renders gradient defs inside svg', () => {
    const wrapper = mount(AppIcon, { props: { name: 'monitor' } })
    expect(wrapper.find('linearGradient').exists()).toBe(true)
  })
})

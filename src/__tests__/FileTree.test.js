import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FileTree from '@/components/project/FileTree.vue'

function makeFs({ tree = [], files = {} } = {}) {
  return {
    listTree: vi.fn(async () => tree),
    getFile: vi.fn(async (path) => {
      const f = files[path]
      if (!f) throw new Error(`not found: ${path}`)
      return f
    }),
    putFile: vi.fn(async ({ path }) => ({ sha: `put-${path}` })),
  }
}

describe('FileTree', () => {
  it('renders merged entries with markers', async () => {
    const base = makeFs({ tree: [{ path: 'a.yaml', type: 'blob', sha: 'base-a' }] })
    const overlay = makeFs({
      tree: [
        { path: 'a.yaml', type: 'blob', sha: 'ov-a' },
        { path: 'b.yaml', type: 'blob', sha: 'ov-b' },
      ],
    })
    const wrapper = mount(FileTree, { props: { baseFs: base, overlayFs: overlay } })
    await flushPromises()
    const rows = wrapper.findAll('[data-path]')
    expect(rows.length).toBe(2)
    const byPath = Object.fromEntries(
      rows.map((r) => [r.attributes('data-path'), r.attributes('data-marker')]),
    )
    expect(byPath['a.yaml']).toBe('overlay_override')
    expect(byPath['b.yaml']).toBe('overlay')
  })

  it('fork-to-override writes overlay file with fork header containing base sha', async () => {
    const base = makeFs({
      tree: [{ path: 'roles/foo.yml', type: 'blob', sha: 'base-sha-x' }],
      files: {
        'roles/foo.yml': { content: 'roles:\n  - foo\n', sha: 'base-sha-x' },
      },
    })
    const overlay = makeFs({ tree: [] })

    const wrapper = mount(FileTree, { props: { baseFs: base, overlayFs: overlay, selectedPath: 'roles/foo.yml' } })
    await flushPromises()

    // Simulate right-click context menu → fork
    const row = wrapper.find('[data-path="roles/foo.yml"]')
    expect(row.exists()).toBe(true)
    await row.trigger('contextmenu')
    await flushPromises()
    const forkBtn = wrapper.find('[role="menuitem"]')
    expect(forkBtn.exists()).toBe(true)
    await forkBtn.trigger('click')
    await flushPromises()

    expect(overlay.putFile).toHaveBeenCalledOnce()
    const call = overlay.putFile.mock.calls[0][0]
    expect(call.path).toBe('roles/foo.yml')
    expect(call.content).toContain('# Range42: forked from base overlay')
    expect(call.content).toContain('# forked_from_sha: base-sha-x')
    expect(call.content).toContain('roles:\n  - foo\n')

    const forkEvents = wrapper.emitted('fork') || []
    expect(forkEvents.length).toBeGreaterThan(0)
    expect(forkEvents[0][0]).toEqual({ path: 'roles/foo.yml', baseSha: 'base-sha-x' })
  })
})

it('groups nested files into collapsible folders and reveals the selected file', async () => {
  const baseFs=makeFs({tree:[{path:'platforms/alpha/main.yml',type:'blob',sha:'base'}]})
  const overlayFs=makeFs({tree:[{path:'platforms/alpha/main.yml',type:'blob',sha:'override'},{path:'platform_runtime/bundles/main.yml',type:'blob',sha:'runtime'},{path:'root.yml',type:'blob',sha:'root'}]})
  const wrapper=mount(FileTree,{props:{baseFs,overlayFs}})
  await flushPromises()
  expect(wrapper.find('[data-folder="platforms"]').exists()).toBe(true)
  expect(wrapper.find('[data-path="platforms/alpha/main.yml"]').exists()).toBe(false)
  await wrapper.get('[data-folder="platforms"] button').trigger('click')
  await wrapper.get('[data-folder="platforms/alpha"] button').trigger('click')
  const file=wrapper.get('[data-path="platforms/alpha/main.yml"]')
  expect(file.text()).toContain('main.yml');expect(file.text()).not.toContain('platforms/alpha/')
  expect(file.attributes('data-marker')).toBe('overlay_override')
  await file.trigger('click')
  expect(wrapper.emitted('select').at(-1)[0]).toEqual({path:'platforms/alpha/main.yml',fsKind:'overlay'})
  await wrapper.get('[data-folder="platforms"] button').trigger('click')
  expect(wrapper.find('[data-path="platforms/alpha/main.yml"]').exists()).toBe(false)
  await wrapper.setProps({selectedPath:'platform_runtime/bundles/main.yml'})
  expect(wrapper.find('[data-path="platform_runtime/bundles/main.yml"]').exists()).toBe(true)
  expect(wrapper.find('[data-path="platforms/alpha/main.yml"]').exists()).toBe(false)
  wrapper.unmount()
})

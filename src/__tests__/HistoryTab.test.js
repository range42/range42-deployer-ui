import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import HistoryTab from '@/components/project/HistoryTab.vue'

function makeProvider(commits, files = {}) {
  return {
    listCommits: vi.fn(async () => commits),
    getFile: vi.fn(async ({ ref }) => {
      const f = files[ref]
      if (!f) throw new Error(`missing ref ${ref}`)
      return { content: f, sha: ref }
    }),
  }
}

describe('HistoryTab', () => {
  it('calls listCommits with the given locator and renders rows', async () => {
    const provider = makeProvider([
      { sha: 'abc1234', message: 'first', author: 'Alice', date: '2026-04-01T00:00:00Z' },
      { sha: 'def5678', message: 'second', author: 'Bob', date: '2026-04-02T00:00:00Z' },
    ])
    const wrapper = mount(HistoryTab, {
      props: {
        provider,
        locator: { owner: 'acme', repo: 'lab', path: 'range42.yaml', ref: 'main' },
      },
    })
    await flushPromises()
    expect(provider.listCommits).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'lab',
      path: 'range42.yaml',
      ref: 'main',
    })
    const rows = wrapper.findAll('[data-sha]')
    expect(rows.length).toBe(2)
    expect(rows[0].text()).toContain('abc1234')
    expect(rows[0].text()).toContain('first')
    expect(rows[0].text()).toContain('Alice')
  })

  it('clicking a commit fetches before+after blobs and renders them in DiffViewer', async () => {
    const provider = makeProvider(
      [
        { sha: 'c2', message: 'second', author: 'Bob', date: '2026-04-02T00:00:00Z' },
        { sha: 'c1', message: 'first', author: 'Alice', date: '2026-04-01T00:00:00Z' },
      ],
      { c1: 'first-content', c2: 'second-content' },
    )
    const wrapper = mount(HistoryTab, {
      props: {
        provider,
        locator: { owner: 'acme', repo: 'lab', path: 'range42.yaml' },
      },
    })
    await flushPromises()
    const row = wrapper.find('[data-sha="c2"]')
    await row.trigger('click')
    await flushPromises()
    expect(provider.getFile).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'c2', path: 'range42.yaml' }),
    )
    expect(provider.getFile).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'c1', path: 'range42.yaml' }),
    )
    const html = wrapper.html()
    expect(html).toContain('first-content')
    expect(html).toContain('second-content')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Stub @vue-flow/core and @vue-flow/node-resizer — these rely on a VueFlow
// provider context that we don't set up in unit tests. We only care about
// GroupNode's own behavior (header, chip, toggle events, previews).
vi.mock('@vue-flow/core', () => ({
  Handle: { name: 'HandleStub', props: ['type', 'position'], template: '<div class="handle-stub" />' },
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))
vi.mock('@vue-flow/node-resizer', () => ({
  NodeResizer: { name: 'NodeResizerStub', template: '<div class="resizer-stub" />' },
}))

import GroupNode from '../components/nodes/GroupNode.vue'

function mountNode(data = {}, selected = false) {
  return mount(GroupNode, { props: { data: { id: 'g1', ...data }, selected } })
}

describe('GroupNode (Plan C §6 — team_scope replication)', () => {
  it('mounts as a topology_group by default and does not show the team-scope chip', () => {
    const wrapper = mountNode({ config: { name: 'Red Team' } })
    const root = wrapper.find('.group-container')
    expect(root.attributes('data-kind')).toBe('topology_group')
    expect(wrapper.find('[data-testid="team-scope-chip-g1"]').exists()).toBe(false)
    // Kind toggle button exists and reads "Group"
    const toggle = wrapper.find('[data-testid="group-kind-toggle-g1"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toBe('Group')
  })

  it('renders the ×N at deploy chip + thicker accent border for team_scope', () => {
    const wrapper = mountNode({ kind: 'team_scope', team_count: 3 })
    expect(wrapper.find('.group-container').attributes('data-kind')).toBe('team_scope')
    expect(wrapper.find('.group-container').attributes('data-team-count')).toBe('3')
    const chip = wrapper.find('[data-testid="team-scope-chip-g1"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('×3 at deploy')
    // Accent border classes flip to indigo when team_scope
    expect(wrapper.find('.group-container > div.absolute.inset-0.rounded-xl').classes())
      .toEqual(expect.arrayContaining(['border-indigo-500/70']))
  })

  it('falls back to defaults.team_count when team_count is unset', () => {
    const wrapper = mountNode({ kind: 'team_scope', defaults: { team_count: 5 } })
    expect(wrapper.find('.group-container').attributes('data-team-count')).toBe('5')
    expect(wrapper.find('[data-testid="team-scope-chip-g1"]').text()).toContain('×5')
  })

  it('clicking the kind toggle emits update:kind + update:scope (topology -> team_scope)', async () => {
    const wrapper = mountNode({})
    await wrapper.find('[data-testid="group-kind-toggle-g1"]').trigger('click')
    expect(wrapper.emitted('update:kind')?.[0]).toEqual(['team_scope'])
    expect(wrapper.emitted('update:scope')?.[0]).toEqual(['team_scope'])
  })

  it('clicking the kind toggle emits topology_group when currently team_scope', async () => {
    const wrapper = mountNode({ kind: 'team_scope' })
    await wrapper.find('[data-testid="group-kind-toggle-g1"]').trigger('click')
    expect(wrapper.emitted('update:kind')?.[0]).toEqual(['topology_group'])
  })

  it('expand toggle is hidden for topology_group and visible for team_scope', async () => {
    const topo = mountNode({})
    expect(topo.find('[data-testid="group-expand-toggle-g1"]').exists()).toBe(false)

    const team = mountNode({ kind: 'team_scope', team_count: 4 })
    const btn = team.find('[data-testid="group-expand-toggle-g1"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(team.emitted('update:expanded')?.[0]).toEqual([true])
  })

  it('when _expanded_preview is on, renders N-1 faint duplicated outlines (capped at 6 total)', () => {
    const wrapper = mountNode({ kind: 'team_scope', team_count: 4, _expanded_preview: true })
    // 4 teams => 3 clone outlines (the primary group itself is outline 1)
    const labels = wrapper.findAll('span').filter((el) => /^team \d+$/.test(el.text()))
    expect(labels.length).toBe(3)
    // Labels are 2..N
    expect(labels.map((el) => el.text())).toEqual(['team 2', 'team 3', 'team 4'])
  })

  it('caps the expanded preview at 6 teams for display sanity', () => {
    const wrapper = mountNode({ kind: 'team_scope', team_count: 20, _expanded_preview: true })
    const labels = wrapper.findAll('span').filter((el) => /^team \d+$/.test(el.text()))
    // cap 6 → clones 2..6 = 5 labels
    expect(labels.length).toBe(5)
  })
})

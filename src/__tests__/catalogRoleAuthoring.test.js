import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildCatalogRole } from '@/services/catalogRoleAuthoring'

const validRole = {
  category: 'software', action: 'install', target: 'example_service',
  description: 'Configure the example service', tags: 'service, example, service',
  tasks: '- name: Install the service\n  ansible.builtin.package:\n    name: example\n    state: present\n',
  defaults: 'example_port: 8080\n',
}

describe('catalog role authoring', () => {
  it('creates executable role files at the documented catalog path', () => {
    const draft = buildCatalogRole(validRole)
    expect(draft.name).toBe('software.install.example_service')
    expect(draft.path).toBe('02_ansible_layer/admin/roles/software.install.example_service')
    expect(Object.keys(draft.files)).toEqual([
      `${draft.path}/tasks/main.yml`, `${draft.path}/meta/main.yml`,
      `${draft.path}/defaults/main.yml`, `${draft.path}/README.md`,
    ])
    expect(parse(draft.files[`${draft.path}/tasks/main.yml`])[0]['ansible.builtin.package']).toEqual({ name: 'example', state: 'present' })
    expect(parse(draft.files[`${draft.path}/meta/main.yml`])).toEqual({
      galaxy_info: { description: validRole.description, galaxy_tags: ['service', 'example'] }, dependencies: [],
    })
    expect(parse(draft.files[`${draft.path}/defaults/main.yml`])).toEqual({ example_port: 8080 })
    expect(draft.files[`${draft.path}/README.md`]).toContain(validRole.description)
  })

  it('supports existing dotted and hyphenated target conventions and empty defaults', () => {
    const draft = buildCatalogRole({ ...validRole, target: 'warmup.local-bin', defaults: '' })
    expect(draft.name).toBe('software.install.warmup.local-bin')
    expect(parse(draft.files[`${draft.path}/defaults/main.yml`])).toEqual({})
  })

  it.each([
    ['category', '../software'], ['action', 'install/foo'], ['target', '../example'],
    ['target', 'example..service'], ['target', 'Example'], ['target', ''],
  ])('rejects invalid %s naming before generating paths', (field, value) => {
    expect(() => buildCatalogRole({ ...validRole, [field]: value })).toThrow(/lowercase|name/i)
  })

  it.each([
    'name: a task', '[]', '- text', '- {}', '- name: Broken\n  debug: [',
    '- hosts: all\n  tasks: []',
  ])('requires a nonempty Ansible task list: %s', (tasks) => {
    expect(() => buildCatalogRole({ ...validRole, tasks })).toThrow(/task|YAML/i)
  })

  it('requires defaults to be a mapping and a description to be present', () => {
    expect(() => buildCatalogRole({ ...validRole, defaults: '- 8080' })).toThrow(/defaults.*mapping/i)
    expect(() => buildCatalogRole({ ...validRole, description: '  ' })).toThrow(/description/i)
  })

  it('preserves comments and quoted Ansible variables in executable YAML', () => {
    const tasks = '# Configure a file\n- name: Write greeting\n  ansible.builtin.copy:\n    content: "{{ greeting }}"\n    dest: /tmp/greeting\n'
    const draft = buildCatalogRole({ ...validRole, tasks })
    expect(draft.files[`${draft.path}/tasks/main.yml`]).toBe(tasks)
  })

  it.each(['', '/tasks/main.yml', '/files/custom.conf'])('rejects any existing item at the role directory%s', (suffix) => {
    const path = '02_ansible_layer/admin/roles/software.install.example_service'
    expect(() => buildCatalogRole(validRole, [`${path}${suffix}`])).toThrow(/already exists/i)
  })

  it('does not confuse a similarly named role with a directory collision', () => {
    const draft = buildCatalogRole(validRole, ['02_ansible_layer/admin/roles/software.install.example_service_extra/tasks/main.yml'])
    expect(draft.name).toBe('software.install.example_service')
  })
})

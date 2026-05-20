import { describe, it, expect } from 'vitest'
import { CHANGE_CATEGORIES, getChangeCategory, getChangeLabel } from '@/constants/changeCategories'

describe('changeCategories', () => {
  it('categorizes tags as live', () => {
    expect(getChangeCategory('tags')).toBe('live')
  })

  it('categorizes name as live', () => {
    expect(getChangeCategory('name')).toBe('live')
  })

  it('categorizes description as live', () => {
    expect(getChangeCategory('description')).toBe('live')
  })

  it('categorizes cores as restart', () => {
    expect(getChangeCategory('cores')).toBe('restart')
  })

  it('categorizes memory as restart', () => {
    expect(getChangeCategory('memory')).toBe('restart')
  })

  it('returns human-readable labels', () => {
    expect(getChangeLabel('cores')).toBe('CPU Cores')
    expect(getChangeLabel('memory')).toBe('Memory')
    expect(getChangeLabel('tags')).toBe('Tags')
    expect(getChangeLabel('name')).toBe('Name')
    expect(getChangeLabel('description')).toBe('Description')
  })

  it('returns unknown category for unmapped fields', () => {
    expect(getChangeCategory('someFutureField')).toBe('redeploy')
  })

  it('has all fields in CHANGE_CATEGORIES', () => {
    expect(Object.keys(CHANGE_CATEGORIES)).toEqual(
      expect.arrayContaining(['tags', 'name', 'description', 'cores', 'memory'])
    )
  })
})

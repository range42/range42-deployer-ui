import { expect, it } from 'vitest'
import { catalogKinds, catalogCapabilities } from '@/services/catalogPresentation'

it('lets users filter and open native scenarios without attaching a complete lab to one VM', () => {
  expect(catalogKinds).toContain('scenario')
  expect(catalogCapabilities('scenario')).toEqual({ create: true, append: false })
})

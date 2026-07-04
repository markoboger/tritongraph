import { describe, expect, it } from 'vitest'
import { resolveRelativeImport } from '../../../packages/triton-core/src/pythonCodeModel'

describe('resolveRelativeImport', () => {
  describe('in a plain module (clinic.animals.domestic)', () => {
    it('resolves one dot to a sibling module', () => {
      expect(resolveRelativeImport('clinic.animals.domestic', false, 1, 'base')).toBe(
        'clinic.animals.base',
      )
    })

    it('resolves two dots to the parent package', () => {
      expect(resolveRelativeImport('clinic.animals.domestic', false, 2, 'staff.vet')).toBe(
        'clinic.staff.vet',
      )
    })

    it('resolves a bare `from . import x` to the containing package', () => {
      expect(resolveRelativeImport('clinic.animals.domestic', false, 1, '')).toBe('clinic.animals')
    })

    it('drops imports that point above the known root', () => {
      expect(resolveRelativeImport('main', false, 1, '')).toBeNull()
      expect(resolveRelativeImport('main', false, 2, 'x')).toBe('x')
    })
  })

  describe('in a package __init__.py (clinic.animals)', () => {
    it('resolves one dot to the package itself, not its parent', () => {
      expect(resolveRelativeImport('clinic.animals', true, 1, 'base')).toBe('clinic.animals.base')
    })

    it('resolves a bare `from . import x` to the package itself', () => {
      expect(resolveRelativeImport('clinic.animals', true, 1, '')).toBe('clinic.animals')
    })

    it('resolves two dots to the parent package', () => {
      expect(resolveRelativeImport('clinic.animals', true, 2, 'staff')).toBe('clinic.staff')
    })

    it('keeps a top-level __init__.py inside its own package', () => {
      expect(resolveRelativeImport('clinic', true, 1, 'animals')).toBe('clinic.animals')
    })
  })
})

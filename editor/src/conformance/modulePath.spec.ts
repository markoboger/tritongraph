import { describe, it, expect } from 'vitest'
import { relativeFilePathToModulePath } from '../../../packages/triton-core/src/pythonCodeModel'

describe('relativeFilePathToModulePath', () => {
  it('drops the .py suffix and dots the path', () => {
    expect(relativeFilePathToModulePath('app/domain/order.py')).toBe('app.domain.order')
  })

  it('treats __init__.py as the package', () => {
    expect(relativeFilePathToModulePath('app/domain/__init__.py')).toBe('app.domain')
  })

  it('strips a configured source root, or a leading src/ when no root matched', () => {
    expect(relativeFilePathToModulePath('backend/src/app/api.py', ['backend/src'])).toBe('app.api')
    expect(relativeFilePathToModulePath('src/app/api.py')).toBe('app.api')
  })

  it('does not strip src/ after a source root already matched', () => {
    // A root of `backend` (not `backend/src`) keeps the src segment — same as the editor parser.
    expect(relativeFilePathToModulePath('backend/src/app/models.py', ['backend'])).toBe('src.app.models')
  })

  it('picks the longest matching source root', () => {
    expect(relativeFilePathToModulePath('backend/src/app/models.py', ['backend', 'backend/src'])).toBe(
      'app.models',
    )
  })
})

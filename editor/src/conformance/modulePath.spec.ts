import { describe, it, expect } from 'vitest'
import { filePathToModulePath } from '../../../packages/triton-conformance/src/modulePath'

describe('filePathToModulePath', () => {
  it('drops the .py suffix and dots the path', () => {
    expect(filePathToModulePath('app/domain/order.py')).toBe('app.domain.order')
  })

  it('treats __init__.py as the package', () => {
    expect(filePathToModulePath('app/domain/__init__.py')).toBe('app.domain')
  })

  it('strips a configured source root, then a leading src/', () => {
    expect(filePathToModulePath('backend/src/app/api.py', ['backend/src'])).toBe('app.api')
    expect(filePathToModulePath('src/app/api.py')).toBe('app.api')
  })
})

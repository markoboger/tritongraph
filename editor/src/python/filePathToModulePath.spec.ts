import { describe, expect, it } from 'vitest'

import { filePathToModulePath } from './parsePythonWithTreeSitter'

describe('filePathToModulePath', () => {
  it('keeps bundled-example paths (no source roots, no src/) as-is', () => {
    expect(filePathToModulePath('clinic/animals/base.py', 'python-examples/animal-clinic')).toBe(
      'clinic.animals.base',
    )
    expect(
      filePathToModulePath('clinic/staff/__init__.py', 'python-examples/animal-clinic'),
    ).toBe('clinic.staff')
  })

  it('strips a matching src/ source root (single-package workspace)', () => {
    expect(filePathToModulePath('src/app/iam/models.py', '/abs/nova-backend', ['src'])).toBe(
      'app.iam.models',
    )
  })

  it('strips the longest matching source root in a monorepo', () => {
    const roots = ['infrastructure', 'nova-backend/src', 'oa-contracts/src', 'oa-runner/src']
    expect(filePathToModulePath('nova-backend/src/app/iam/models.py', '/abs/nova-modulith', roots)).toBe(
      'app.iam.models',
    )
    expect(filePathToModulePath('oa-contracts/src/oa_contracts/dto.py', '/abs/nova-modulith', roots)).toBe(
      'oa_contracts.dto',
    )
    expect(
      filePathToModulePath('infrastructure/infrastructure/config.py', '/abs/nova-modulith', roots),
    ).toBe('infrastructure.config')
  })

  it('does not strip a package segment that merely looks like a source root', () => {
    // `app` is a real package, not a source root — only `nova-backend/src` is stripped.
    expect(
      filePathToModulePath('nova-backend/src/app/core/db.py', '/abs/nova-modulith', ['nova-backend/src']),
    ).toBe('app.core.db')
  })

  it('falls back to stripping a leading src/ when no source root matches', () => {
    expect(filePathToModulePath('src/pkg/mod.py', '/abs/proj', [])).toBe('pkg.mod')
  })
})

/**
 * ponytail: minimal stand-in for the one Node API gitDiff.ts uses, so the package typechecks
 * without pulling a full toolchain. Superseded automatically once @types/node is installed (it is a
 * declared devDependency). Remove this file when that happens.
 */
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: { cwd?: string; encoding: 'utf8' },
  ): string
}

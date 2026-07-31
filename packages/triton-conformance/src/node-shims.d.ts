/**
 * ponytail: minimal stand-ins for the Node/js-yaml surface the CLI and gitDiff use, so the package
 * typechecks without a full toolchain installed. Superseded automatically once @types/node and
 * @types/js-yaml are installed (both declared as devDependencies). Remove this file when that happens.
 */
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: {
      cwd?: string
      encoding: 'utf8'
      maxBuffer?: number
      stdio?: readonly ('pipe' | 'ignore' | 'inherit')[]
    },
  ): string
}

declare module 'node:crypto' {
  export interface Hash {
    update(data: string): Hash
    digest(encoding: 'hex'): string
  }
  export function createHash(algorithm: string): Hash
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function appendFileSync(path: string, data: string): void
  export interface Dirent {
    name: string
    isDirectory(): boolean
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function relative(from: string, to: string): string
  export function dirname(path: string): string
  export const sep: string
}

declare module 'js-yaml' {
  export function load(text: string): unknown
  export function dump(value: unknown): string
  const _default: { load: typeof load; dump: typeof dump }
  export default _default
}

declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  cwd(): string
  exit(code: number): never
}

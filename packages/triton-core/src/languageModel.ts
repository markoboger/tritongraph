/**
 * Language-neutral code model used between source analyzers and diagram projection.
 *
 * Parsers should translate language-specific syntax into this model first. Diagram code can then
 * decide how to render containment, dependency layout, artefact panels, and IDE links without
 * knowing whether the source language was Scala, TypeScript, or something else.
 */

export type LanguageId =
  | 'scala'
  | 'typescript'
  | 'javascript'
  | 'java'
  | 'kotlin'
  | 'python'
  | 'rust'
  | 'go'
  | 'ruby'
  | 'swift'
  | 'unknown'

export type CodeContainerKind =
  | 'workspace'
  | 'module'
  | 'package'
  | 'folder'
  | 'namespace'

export type CodeArtefactKind =
  | 'class'
  | 'case-class'
  | 'object'
  | 'case-object'
  | 'trait'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'value'
  | 'variable'
  | 'given'
  | 'unknown'

export type CodeMemberKind =
  | 'constructor'
  | 'method'
  | 'function'
  | 'property'
  | 'field'
  | 'parameter'
  | 'call-signature'
  | 'unknown'

export type CodeRelationKind =
  | 'imports'
  | 'extends'
  | 'implements'
  | 'returns'
  | 'accepts'
  | 'creates'
  | 'calls'
  | 'contains'

export type CodeRelationScope = 'container' | 'artefact' | 'member'

export interface SourceLocation {
  /**
   * Path relative to the analyzed project/example root. Kept relative so generated diagrams remain
   * portable and the UI can resolve it against the active workspace or example.
   */
  file: string
  /** 0-indexed start row. */
  startRow: number
  /** 0-indexed start column, when the analyzer can provide it. */
  startColumn?: number
  /** 0-indexed end row, when the analyzer can provide it. */
  endRow?: number
  /** 0-indexed end column, when the analyzer can provide it. */
  endColumn?: number
}

export interface CodeMember {
  id: string
  name: string
  kind: CodeMemberKind
  language: LanguageId
  declaration: string
  source?: SourceLocation
  documentation?: string
}

export interface CodeArtefact {
  id: string
  name: string
  kind: CodeArtefactKind
  language: LanguageId
  declaration: string
  source: SourceLocation
  documentation?: string
  members: readonly CodeMember[]
}

export interface CodeContainer {
  id: string
  name: string
  kind: CodeContainerKind
  language: LanguageId
  source?: SourceLocation
  children: readonly CodeContainer[]
  artefacts: readonly CodeArtefact[]
}

export interface CodeRelation {
  id: string
  from: string
  to: string
  kind: CodeRelationKind
  scope: CodeRelationScope
  source?: SourceLocation
  /**
   * Optional language-specific wording used for display only. The canonical `kind` remains the
   * semantic contract used for filtering, layout, and projections.
   */
  label?: string
  metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface CodeModel {
  id: string
  name: string
  language: LanguageId
  root: CodeContainer
  relations: readonly CodeRelation[]
}


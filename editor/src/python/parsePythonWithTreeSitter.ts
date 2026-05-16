import { Language, Parser, type Node as TSNode } from 'web-tree-sitter'

import treeSitterRuntimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import treeSitterPythonWasmUrl from 'tree-sitter-python/tree-sitter-python.wasm?url'

export type {
  ParsedPythonImport,
  ParsedPythonArtefact,
  ParsedPythonMember,
  PythonFileSummary,
} from '../../../packages/triton-core/src/pythonCodeModel'
import type {
  ParsedPythonImport,
  ParsedPythonArtefact,
  ParsedPythonMember,
  PythonFileSummary,
} from '../../../packages/triton-core/src/pythonCodeModel'

let initPromise: Promise<void> | null = null
let pythonLanguagePromise: Promise<Language> | null = null

async function fetchWasm(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load wasm at ${url}: ${res.status} ${res.statusText}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function ensurePythonLanguage(): Promise<Language> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile() {
        return treeSitterRuntimeWasmUrl
      },
    })
  }
  await initPromise
  if (!pythonLanguagePromise) {
    pythonLanguagePromise = (async () => {
      const bytes = await fetchWasm(treeSitterPythonWasmUrl)
      return Language.load(bytes)
    })()
  }
  return pythonLanguagePromise
}

let cachedParser: Parser | null = null

async function getParser(): Promise<Parser> {
  const lang = await ensurePythonLanguage()
  if (!cachedParser) {
    cachedParser = new Parser()
    cachedParser.setLanguage(lang)
  }
  return cachedParser
}


function parseImportStatement(node: TSNode): ParsedPythonImport[] {
  const out: ParsedPythonImport[] = []
  for (const child of node.namedChildren) {
    if (child.type === 'dotted_name') {
      const modulePath = child.text.trim()
      out.push({ raw: `import ${modulePath}`, modulePath, names: [] })
    } else if (child.type === 'aliased_import') {
      const nameNode = child.childForFieldName('name')
      if (nameNode) {
        const modulePath = nameNode.text.trim()
        out.push({ raw: child.text.trim(), modulePath, names: [] })
      }
    }
  }
  return out
}

function resolveModuleName(moduleNode: TSNode, currentModulePath: string): string {
  if (moduleNode.type === 'relative_import') {
    const inner = moduleNode.namedChildren.find((c) => c.type === 'dotted_name')
    // Count leading dots: 1 dot = current package, 2 dots = parent package, etc.
    const dotCount = (/^\.+/.exec(moduleNode.text) ?? [''])[0].length
    const parts = currentModulePath.split('.')
    const parentParts = parts.slice(0, Math.max(0, parts.length - dotCount))
    const parent = parentParts.join('.')
    if (inner) return parent ? `${parent}.${inner.text.trim()}` : inner.text.trim()
    return parent
  }
  return moduleNode.text.trim()
}

function collectImportedNames(node: TSNode, moduleNode: TSNode | null): string[] {
  const names: string[] = []
  for (const child of node.namedChildren) {
    if (child === moduleNode) continue
    if (child.type === 'wildcard_import') names.push('*')
    else if (child.type === 'identifier') names.push(child.text.trim())
    else if (child.type === 'aliased_import') {
      const nameNode = child.childForFieldName('name')
      if (nameNode) names.push(nameNode.text.trim())
    }
  }
  return names
}

function parseImportFromStatement(node: TSNode, currentModulePath: string): ParsedPythonImport {
  const moduleNode = node.childForFieldName('module_name')
  const modulePath = moduleNode ? resolveModuleName(moduleNode, currentModulePath) : ''
  const names = collectImportedNames(node, moduleNode)
  return { raw: node.text.trim(), modulePath, names }
}

function parseFunctionSignature(node: TSNode): string {
  const name = node.childForFieldName('name')?.text.trim() ?? ''
  const params = node.childForFieldName('parameters')?.text.trim() ?? '()'
  const ret = node.childForFieldName('return_type')
  return ret ? `def ${name}${params} -> ${ret.text.trim()}` : `def ${name}${params}`
}

function parseMethods(classBody: TSNode): ParsedPythonMember[] {
  const out: ParsedPythonMember[] = []
  for (const child of classBody.namedChildren) {
    let funcNode: TSNode | null = null
    const startRow = child.startPosition.row
    const endRow = child.endPosition.row
    if (child.type === 'function_definition') {
      funcNode = child
    } else if (child.type === 'decorated_definition') {
      const inner = child.childForFieldName('definition')
      if (inner?.type === 'function_definition') funcNode = inner
    }
    if (!funcNode) continue
    const name = funcNode.childForFieldName('name')?.text.trim() ?? ''
    out.push({ name, kind: 'method', startRow, endRow, signature: parseFunctionSignature(funcNode) })
  }
  return out
}

function parseClassDef(node: TSNode, decorators: string[]): ParsedPythonArtefact {
  const name = node.childForFieldName('name')?.text.trim() ?? ''
  const superclassesNode = node.childForFieldName('superclasses')
  const bodyNode = node.childForFieldName('body')

  const bases: string[] = []
  if (superclassesNode) {
    for (const child of superclassesNode.namedChildren) {
      if (child.type === 'identifier' || child.type === 'attribute') {
        bases.push(child.text.trim())
      }
    }
  }

  return {
    name,
    kind: 'class',
    startRow: node.startPosition.row,
    endRow: node.endPosition.row,
    bases,
    decorators,
    members: bodyNode ? parseMethods(bodyNode) : [],
  }
}

function parseFunctionDef(node: TSNode, decorators: string[]): ParsedPythonArtefact {
  const name = node.childForFieldName('name')?.text.trim() ?? ''
  return {
    name,
    kind: 'function',
    startRow: node.startPosition.row,
    endRow: node.endPosition.row,
    bases: [],
    decorators,
    members: [],
    signature: parseFunctionSignature(node),
  }
}

function extractDecorators(nodes: readonly TSNode[]): string[] {
  return nodes.filter((n) => n.type === 'decorator').map((d) => d.text.trim())
}

function filePathToModulePath(filePath: string, projectRoot: string): string {
  let rel = filePath.replaceAll('\\', '/')
  const root = projectRoot.replaceAll('\\', '/').replace(/\/?$/, '/')
  if (rel.startsWith(root)) rel = rel.slice(root.length)
  rel = rel.replace(/^\/+/, '')
  if (rel.endsWith('/__init__.py')) rel = rel.slice(0, -'/__init__.py'.length)
  else if (rel.endsWith('.py')) rel = rel.slice(0, -'.py'.length)
  return rel.replaceAll('/', '.')
}

export async function summarizePython(
  source: string,
  filePath: string,
  projectRoot: string,
): Promise<PythonFileSummary> {
  const modulePath = filePathToModulePath(filePath, projectRoot)
  const parser = await getParser()
  const tree = parser.parse(source)
  if (!tree) return { modulePath, filePath, imports: [], topLevel: [] }
  const root = tree.rootNode

  const imports: ParsedPythonImport[] = []
  const topLevel: ParsedPythonArtefact[] = []

  for (const child of root.namedChildren) {
    if (child.type === 'import_statement') {
      imports.push(...parseImportStatement(child))
    } else if (child.type === 'import_from_statement') {
      imports.push(parseImportFromStatement(child, modulePath))
    } else if (child.type === 'class_definition') {
      topLevel.push(parseClassDef(child, []))
    } else if (child.type === 'function_definition') {
      topLevel.push(parseFunctionDef(child, []))
    } else if (child.type === 'decorated_definition') {
      const decorators = extractDecorators(child.namedChildren)
      const defNode = child.childForFieldName('definition')
      if (defNode?.type === 'class_definition') {
        topLevel.push(parseClassDef(defNode, decorators))
      } else if (defNode?.type === 'function_definition') {
        topLevel.push(parseFunctionDef(defNode, decorators))
      }
    }
  }

  tree.delete()

  return { modulePath, filePath, imports, topLevel }
}

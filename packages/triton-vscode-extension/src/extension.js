const vscode = require('vscode')

const EXTENSION_ID = 'triton.triton-vscode-extension'
const OUTPUT_CHANNEL_NAME = 'Triton'

function outputChannel() {
  if (!outputChannel.instance) {
    outputChannel.instance = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME)
  }
  return outputChannel.instance
}

function normalizeServerUrl(raw) {
  const fallback = 'http://127.0.0.1:5173'
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  try {
    const url = new URL(value)
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

function currentWorkspaceFolder() {
  const editorUri = vscode.window.activeTextEditor?.document?.uri
  if (editorUri) {
    const folder = vscode.workspace.getWorkspaceFolder(editorUri)
    if (folder) return folder
  }
  return vscode.workspace.workspaceFolders?.[0]
}

function workspaceRelativePath(folder, targetUri) {
  try {
    return vscode.workspace.asRelativePath(targetUri, false)
  } catch {
    return ''
  }
}

function buildIdeOpenUrlTemplate(folder) {
  const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://${EXTENSION_ID}/open-source`)
  return uri.with({
    query: new URLSearchParams({
      folder: folder?.uri.fsPath ?? '',
      relPath: '{relPath}',
      line: '{line}',
      col: '{col}',
    }).toString(),
  }).toString()
}

function buildDiagramUrl(folder) {
  const config = vscode.workspace.getConfiguration('triton')
  const base = normalizeServerUrl(config.get('serverUrl'))
  const url = new URL(base)
  const activeEditor = vscode.window.activeTextEditor
  const relPath = folder && activeEditor ? workspaceRelativePath(folder, activeEditor.document.uri) : ''
  const selection = activeEditor?.selection?.active
  const line = selection ? selection.line + 1 : 1
  const col = selection ? selection.character + 1 : 1
  const ideOpenUrl = buildIdeOpenUrlTemplate(folder)

  if (folder) {
    url.searchParams.set('workspaceFolder', folder.uri.fsPath)
    url.searchParams.set('workspaceName', folder.name)
  }
  if (relPath) url.searchParams.set('activeFile', relPath)
  url.searchParams.set('activeLine', String(line))
  url.searchParams.set('activeCol', String(col))
  url.searchParams.set('ideName', vscode.env.appName)
  url.searchParams.set('ideScheme', vscode.env.uriScheme)
  url.searchParams.set('ideOpenUrl', ideOpenUrl)

  return {
    diagramUrl: url.toString(),
    ideOpenUrl,
    activeFile: relPath,
  }
}

async function openDiagram() {
  const folder = currentWorkspaceFolder()
  const config = vscode.workspace.getConfiguration('triton')
  const openMode = config.get('openMode', 'external')
  const logLinks = config.get('logLinksInOutput', true)
  const { diagramUrl, ideOpenUrl, activeFile } = buildDiagramUrl(folder)
  const out = outputChannel()

  if (logLinks) {
    out.appendLine(`[${new Date().toISOString()}] Triton URL: ${diagramUrl}`)
    out.appendLine(`[${new Date().toISOString()}] IDE callback URL: ${ideOpenUrl}`)
    if (activeFile) out.appendLine(`[${new Date().toISOString()}] Active file: ${activeFile}`)
  }

  if (openMode === 'copy') {
    await vscode.env.clipboard.writeText(diagramUrl)
    vscode.window.showInformationMessage('Triton diagram URL copied to the clipboard.')
    return
  }

  const ok = await vscode.env.openExternal(vscode.Uri.parse(diagramUrl))
  if (!ok) {
    vscode.window.showWarningMessage('Triton could not open the browser automatically. The URL was copied instead.')
    await vscode.env.clipboard.writeText(diagramUrl)
    return
  }
  vscode.window.showInformationMessage('Triton diagram opened in your browser.')
}

async function copyDiagramUrl() {
  const { diagramUrl } = buildDiagramUrl(currentWorkspaceFolder())
  await vscode.env.clipboard.writeText(diagramUrl)
  outputChannel().appendLine(`[${new Date().toISOString()}] Copied Triton URL: ${diagramUrl}`)
  vscode.window.showInformationMessage('Triton diagram URL copied to the clipboard.')
}

async function revealFileFromUri(uri) {
  const params = new URLSearchParams(uri.query || '')
  const folderPath = params.get('folder') || ''
  const relPath = params.get('relPath') || ''
  if (!folderPath || !relPath) {
    vscode.window.showWarningMessage('Triton open-source link is missing folder or relPath.')
    return
  }

  const line = Math.max(1, Number(params.get('line') || '1'))
  const col = Math.max(1, Number(params.get('col') || '1'))
  const fileUri = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(folderPath), relPath).fsPath)
  const doc = await vscode.workspace.openTextDocument(fileUri)
  const editor = await vscode.window.showTextDocument(doc, { preview: false })
  const pos = new vscode.Position(line - 1, col - 1)
  editor.selection = new vscode.Selection(pos, pos)
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
}

function activate(context) {
  const out = outputChannel()
  out.appendLine(`[${new Date().toISOString()}] Triton extension activated in ${vscode.env.appName}.`)

  context.subscriptions.push(
    out,
    vscode.commands.registerCommand('triton.openDiagram', openDiagram),
    vscode.commands.registerCommand('triton.copyDiagramUrl', copyDiagramUrl),
    vscode.commands.registerCommand('triton.showOutput', () => out.show(true)),
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        out.appendLine(`[${new Date().toISOString()}] Received Triton URI: ${uri.toString()}`)
        if (uri.path !== '/open-source') return
        try {
          await revealFileFromUri(uri)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          out.appendLine(`[${new Date().toISOString()}] Failed to open source: ${message}`)
          vscode.window.showErrorMessage(`Triton could not open the requested source file: ${message}`)
        }
      },
    }),
  )
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
}

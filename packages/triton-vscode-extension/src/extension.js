const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const EXTENSION_ID = 'triton.triton-vscode-extension'
const OUTPUT_CHANNEL_NAME = 'Triton'
const commitRefreshTimers = new Map()
let serverProcess = null
let runtimeProcess = null

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
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

function fileExists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

async function canReachServer(rawUrl) {
  const base = normalizeServerUrl(rawUrl)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    try {
      const res = await fetch(base, { method: 'GET', signal: controller.signal })
      return res.ok || (res.status >= 200 && res.status < 500)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

async function canReachRuntime(rawUrl) {
  const base = normalizeServerUrl(rawUrl)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    try {
      const res = await fetch(`${base}/health`, { method: 'GET', signal: controller.signal })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

function configuredEditorDir() {
  const config = vscode.workspace.getConfiguration('triton')
  const repoPath = String(config.get('localRepoPath', '') || '').trim()
  if (!repoPath) return ''
  return path.join(repoPath, 'editor')
}

function configuredRuntimeDir() {
  const config = vscode.workspace.getConfiguration('triton')
  const repoPath = String(config.get('localRepoPath', '') || '').trim()
  if (!repoPath) return ''
  return path.join(repoPath, 'packages', 'triton-runtime')
}

function validateEditorDir(editorDir) {
  return (
    !!editorDir &&
    fileExists(editorDir) &&
    fileExists(path.join(editorDir, 'package.json'))
  )
}

function validateRuntimeDir(runtimeDir) {
  return !!runtimeDir && fileExists(runtimeDir) && fileExists(path.join(runtimeDir, 'package.json'))
}

async function startServer() {
  const out = outputChannel()
  const config = vscode.workspace.getConfiguration('triton')
  const serverUrl = config.get('serverUrl')
  if (await canReachServer(serverUrl)) {
    out.appendLine(`[${new Date().toISOString()}] Triton server already reachable at ${normalizeServerUrl(serverUrl)}.`)
    return true
  }

  if (serverProcess && !serverProcess.killed) {
    out.appendLine(`[${new Date().toISOString()}] Triton server process already running; waiting for readiness.`)
  } else {
    const editorDir = configuredEditorDir()
    if (!validateEditorDir(editorDir)) {
      vscode.window.showWarningMessage(
        'Triton could not auto-start because `triton.localRepoPath` is not set to a valid repo checkout.',
      )
      return false
    }
    out.appendLine(`[${new Date().toISOString()}] Starting Triton dev server from ${editorDir}`)
    serverProcess = cp.spawn(npmExecutable(), ['run', 'dev'], {
      cwd: editorDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    serverProcess.stdout?.on('data', (chunk) => {
      out.append(chunk.toString())
    })
    serverProcess.stderr?.on('data', (chunk) => {
      out.append(chunk.toString())
    })
    serverProcess.on('exit', (code, signal) => {
      out.appendLine(
        `[${new Date().toISOString()}] Triton dev server exited (code=${String(code)} signal=${String(signal)}).`,
      )
      serverProcess = null
    })
  }

  for (let i = 0; i < 20; i++) {
    await sleep(750)
    if (await canReachServer(serverUrl)) {
      out.appendLine(`[${new Date().toISOString()}] Triton server is reachable at ${normalizeServerUrl(serverUrl)}.`)
      return true
    }
  }
  vscode.window.showWarningMessage('Triton server did not become reachable in time.')
  return false
}

async function stopServer() {
  if (!serverProcess || serverProcess.killed) {
    vscode.window.showInformationMessage('No Triton server process is currently managed by the extension.')
    return
  }
  serverProcess.kill()
  serverProcess = null
  outputChannel().appendLine(`[${new Date().toISOString()}] Requested Triton dev server shutdown.`)
  vscode.window.showInformationMessage('Triton server stop requested.')
}

async function startRuntime() {
  const out = outputChannel()
  const config = vscode.workspace.getConfiguration('triton')
  const runtimeUrl = config.get('runtimeUrl')
  if (await canReachRuntime(runtimeUrl)) {
    out.appendLine(`[${new Date().toISOString()}] Triton runtime already reachable at ${normalizeServerUrl(runtimeUrl)}.`)
    return true
  }

  if (runtimeProcess && !runtimeProcess.killed) {
    out.appendLine(`[${new Date().toISOString()}] Triton runtime process already running; waiting for readiness.`)
  } else {
    const runtimeDir = configuredRuntimeDir()
    if (!validateRuntimeDir(runtimeDir)) {
      vscode.window.showWarningMessage(
        'Triton could not auto-start the runtime because `triton.localRepoPath` is not set to a valid repo checkout.',
      )
      return false
    }
    out.appendLine(`[${new Date().toISOString()}] Starting Triton runtime from ${runtimeDir}`)
    runtimeProcess = cp.spawn(npmExecutable(), ['start'], {
      cwd: runtimeDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    runtimeProcess.stdout?.on('data', (chunk) => {
      out.append(chunk.toString())
    })
    runtimeProcess.stderr?.on('data', (chunk) => {
      out.append(chunk.toString())
    })
    runtimeProcess.on('exit', (code, signal) => {
      out.appendLine(
        `[${new Date().toISOString()}] Triton runtime exited (code=${String(code)} signal=${String(signal)}).`,
      )
      runtimeProcess = null
    })
  }

  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (await canReachRuntime(runtimeUrl)) {
      out.appendLine(`[${new Date().toISOString()}] Triton runtime is reachable at ${normalizeServerUrl(runtimeUrl)}.`)
      return true
    }
  }
  vscode.window.showWarningMessage('Triton runtime did not become reachable in time.')
  return false
}

async function stopRuntime() {
  if (!runtimeProcess || runtimeProcess.killed) {
    vscode.window.showInformationMessage('No Triton runtime process is currently managed by the extension.')
    return
  }
  runtimeProcess.kill()
  runtimeProcess = null
  outputChannel().appendLine(`[${new Date().toISOString()}] Requested Triton runtime shutdown.`)
  vscode.window.showInformationMessage('Triton runtime stop requested.')
}

function probeWorkspace(folder) {
  if (!folder) {
    return {
      kind: 'none',
      isScalaSbt: false,
      hasBuildSbt: false,
      hasProjectDir: false,
      hasScalaSources: false,
      buildFile: '',
    }
  }
  const root = folder.uri.fsPath
  const buildFile = path.join(root, 'build.sbt')
  const projectDir = path.join(root, 'project')
  const scalaMain = path.join(root, 'src', 'main', 'scala')
  const scalaTest = path.join(root, 'src', 'test', 'scala')
  const hasBuildSbt = fileExists(buildFile)
  const hasProjectDir = fileExists(projectDir)
  const hasScalaSources = fileExists(scalaMain) || fileExists(scalaTest)
  const isScalaSbt = hasBuildSbt || hasProjectDir || hasScalaSources
  return {
    kind: isScalaSbt ? 'scala-sbt' : 'generic',
    isScalaSbt,
    hasBuildSbt,
    hasProjectDir,
    hasScalaSources,
    buildFile: hasBuildSbt ? buildFile : '',
  }
}

function logWorkspaceSummary(out, folder, probe) {
  if (!folder) {
    out.appendLine(`[${new Date().toISOString()}] No workspace folder detected.`)
    return
  }
  out.appendLine(
    `[${new Date().toISOString()}] Workspace: ${folder.name} (${folder.uri.fsPath}) [${probe.kind}]`,
  )
  out.appendLine(
    `[${new Date().toISOString()}] Workspace markers: build.sbt=${probe.hasBuildSbt} project/=${probe.hasProjectDir} scalaSources=${probe.hasScalaSources}`,
  )
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

function buildDiagramUrl(folder, options = {}) {
  const config = vscode.workspace.getConfiguration('triton')
  const base = normalizeServerUrl(config.get('serverUrl'))
  const url = new URL(base)
  const runtimeUrl = normalizeServerUrl(config.get('runtimeUrl'))
  const activeEditor = vscode.window.activeTextEditor
  const relPath = folder && activeEditor ? workspaceRelativePath(folder, activeEditor.document.uri) : ''
  const selection = activeEditor?.selection?.active
  const line = selection ? selection.line + 1 : 1
  const col = selection ? selection.character + 1 : 1
  const ideOpenUrl = buildIdeOpenUrlTemplate(folder)
  const probe = probeWorkspace(folder)

  if (folder) {
    url.searchParams.set('workspaceFolder', folder.uri.fsPath)
    url.searchParams.set('workspaceName', folder.name)
    url.searchParams.set('runtimeUrl', runtimeUrl)
  }
  url.searchParams.set('workspaceKind', probe.kind)
  if (relPath) url.searchParams.set('activeFile', relPath)
  url.searchParams.set('activeLine', String(line))
  url.searchParams.set('activeCol', String(col))
  url.searchParams.set('ideName', vscode.env.appName)
  url.searchParams.set('ideScheme', vscode.env.uriScheme)
  url.searchParams.set('ideOpenUrl', ideOpenUrl)
  if (probe.buildFile) url.searchParams.set('buildFile', probe.buildFile)
  if (options.refreshToken) url.searchParams.set('refresh', String(options.refreshToken))

  return {
    diagramUrl: url.toString(),
    ideOpenUrl,
    activeFile: relPath,
    workspaceProbe: probe,
  }
}

async function tryOpenInSimpleBrowser(diagramUrl) {
  try {
    await vscode.commands.executeCommand('simpleBrowser.show', vscode.Uri.parse(diagramUrl), {
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Beside,
    })
    return true
  } catch {
    return false
  }
}

async function openDiagramUrl(diagramUrl, openMode) {
  if (openMode === 'copy') {
    await vscode.env.clipboard.writeText(diagramUrl)
    vscode.window.showInformationMessage('Triton diagram URL copied to the clipboard.')
    return
  }

  if (openMode === 'simple-browser') {
    const ok = await tryOpenInSimpleBrowser(diagramUrl)
    if (ok) {
      vscode.window.showInformationMessage('Triton diagram opened in the simple browser.')
      return
    }
    vscode.window.showWarningMessage('Simple browser is unavailable. Triton fell back to the external browser.')
  }

  if (openMode === 'auto') {
    const looksLikeCursor = /cursor/i.test(vscode.env.appName)
    if (looksLikeCursor) {
      const ok = await tryOpenInSimpleBrowser(diagramUrl)
      if (ok) {
        vscode.window.showInformationMessage('Triton diagram opened in the simple browser.')
        return
      }
    }
  }

  const ok = await vscode.env.openExternal(vscode.Uri.parse(diagramUrl))
  if (!ok) {
    vscode.window.showWarningMessage('Triton could not open the browser automatically. The URL was copied instead.')
    await vscode.env.clipboard.writeText(diagramUrl)
    return
  }
  vscode.window.showInformationMessage('Triton diagram opened in your browser.')
}

async function openDiagram(options = {}) {
  const folder = options.folder || currentWorkspaceFolder()
  const config = vscode.workspace.getConfiguration('triton')
  const openMode = config.get('openMode', 'auto')
  const logLinks = config.get('logLinksInOutput', true)
  const autoStartServer = config.get('autoStartServer', false)
  const autoStartRuntime = config.get('autoStartRuntime', false)
  const serverUrl = config.get('serverUrl')
  const { diagramUrl, ideOpenUrl, activeFile, workspaceProbe } = buildDiagramUrl(folder, options)
  const out = outputChannel()

  const serverReachable = await canReachServer(serverUrl)
  if (!serverReachable && autoStartServer) {
    const started = await startServer()
    if (!started) return
  } else if (!serverReachable) {
    vscode.window.showWarningMessage(
      'Triton server is not reachable. Set `triton.autoStartServer` and `triton.localRepoPath`, or start Triton manually.',
    )
  }

  if (folder && autoStartRuntime) {
    await startRuntime()
  }

  logWorkspaceSummary(out, folder, workspaceProbe)
  if (folder && !workspaceProbe.isScalaSbt) {
    vscode.window.showWarningMessage(
      'Triton did not detect a Scala/sbt workspace marker. The browser will still open, but analysis may not match your project yet.',
    )
  }

  if (logLinks) {
    out.appendLine(`[${new Date().toISOString()}] Triton URL: ${diagramUrl}`)
    out.appendLine(`[${new Date().toISOString()}] IDE callback URL: ${ideOpenUrl}`)
    if (activeFile) out.appendLine(`[${new Date().toISOString()}] Active file: ${activeFile}`)
    out.appendLine(`[${new Date().toISOString()}] Open mode: ${openMode}`)
  }
  await openDiagramUrl(diagramUrl, openMode)
}

async function copyDiagramUrl() {
  const { diagramUrl } = buildDiagramUrl(currentWorkspaceFolder())
  await vscode.env.clipboard.writeText(diagramUrl)
  outputChannel().appendLine(`[${new Date().toISOString()}] Copied Triton URL: ${diagramUrl}`)
  vscode.window.showInformationMessage('Triton diagram URL copied to the clipboard.')
}

async function refreshDiagram() {
  const folder = currentWorkspaceFolder()
  const config = vscode.workspace.getConfiguration('triton')
  const action = config.get('refreshAction', 'reopen')
  let ok = true
  if (action === 'sbt-test') {
    ok = await runSbtTest(folder)
  } else if (action === 'sbt-coverage') {
    ok = await runCoverageReport(folder)
  } else {
    const runtimeBody = await runWorkspaceActionViaRuntime(folder, 'refresh')
    if (runtimeBody) ok = runtimeBody.ok === true
  }
  if (!ok) return
  await openDiagram({ folder, refreshToken: Date.now() })
}

async function showServerUrl() {
  const folder = currentWorkspaceFolder()
  const out = outputChannel()
  const { diagramUrl } = buildDiagramUrl(folder)
  const url = new URL(diagramUrl)
  const serverUrl = `${url.origin}${url.pathname}`.replace(/\/$/, '')
  await vscode.env.clipboard.writeText(serverUrl)
  out.appendLine(`[${new Date().toISOString()}] Triton server URL: ${serverUrl}`)
  out.show(true)
  vscode.window.showInformationMessage('Triton server URL copied to the clipboard.')
}

function clearCommitRefreshTimer(key) {
  const timer = commitRefreshTimers.get(key)
  if (timer) clearTimeout(timer)
  commitRefreshTimers.delete(key)
}

function shellQuote(arg) {
  return `"${String(arg).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function sbtCommandLine(commandText) {
  const config = vscode.workspace.getConfiguration('triton')
  const executable = String(config.get('sbtExecutable', 'sbt') || 'sbt').trim() || 'sbt'
  const text = String(commandText || '').trim()
  if (!text) return executable
  return `${executable} ${shellQuote(text)}`
}

async function executeShellTask(folder, label, commandLine) {
  if (!folder) {
    vscode.window.showWarningMessage(`Triton could not run ${label} because no workspace folder is active.`)
    return false
  }
  const out = outputChannel()
  const taskName = `${label} (${Date.now()})`
  const task = new vscode.Task(
    { type: 'shell' },
    folder,
    taskName,
    'triton',
    new vscode.ShellExecution(commandLine, { cwd: folder.uri.fsPath }),
    [],
  )
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: false,
  }
  out.appendLine(`[${new Date().toISOString()}] Starting task: ${commandLine}`)
  const execution = await vscode.tasks.executeTask(task)
  return await new Promise((resolve) => {
    const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.name !== execution.task.name) return
      disposable.dispose()
      const ok = (event.exitCode ?? 0) === 0
      out.appendLine(
        `[${new Date().toISOString()}] Task finished: ${commandLine} (exit=${String(event.exitCode ?? 0)})`,
      )
      resolve(ok)
    })
  })
}

async function runSbtCommand(folder, commandText, label) {
  const probe = probeWorkspace(folder)
  if (!folder || !probe.isScalaSbt) {
    vscode.window.showWarningMessage(`Triton could not run ${label} because the active workspace does not look like an sbt/Scala project.`)
    return false
  }
  return await executeShellTask(folder, label, sbtCommandLine(commandText))
}

async function runWorkspaceActionViaRuntime(folder, action) {
  if (!folder) return null
  const config = vscode.workspace.getConfiguration('triton')
  const runtimeUrl = config.get('runtimeUrl')
  const autoStartRuntime = config.get('autoStartRuntime', false)
  let reachable = await canReachRuntime(runtimeUrl)
  if (!reachable && autoStartRuntime) {
    const started = await startRuntime()
    if (!started) return null
    reachable = true
  }
  if (!reachable) return null

  const base = normalizeServerUrl(runtimeUrl)
  const res = await fetch(`${base}/api/workspace/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      workspacePath: folder.uri.fsPath,
      sbtExecutable: config.get('sbtExecutable', 'sbt'),
      sbtTestCommand: config.get('sbtTestCommand', 'test'),
      sbtCoverageCommand: config.get('sbtCoverageCommand', 'coverage; test; coverageReport'),
    }),
  })
  const body = await res.json().catch(() => ({}))
  const out = outputChannel()
  out.appendLine(
    `[${new Date().toISOString()}] Runtime action ${action}: HTTP ${res.status} ok=${String(body.ok === true)}`,
  )
  if (typeof body.stdout === 'string' && body.stdout.trim()) out.append(body.stdout)
  if (typeof body.stderr === 'string' && body.stderr.trim()) out.append(body.stderr)
  return body
}

async function runSbtTest(folder = currentWorkspaceFolder()) {
  const runtimeBody = await runWorkspaceActionViaRuntime(folder, 'sbt-test')
  const ok = runtimeBody
    ? runtimeBody.ok === true
    : await runSbtCommand(folder, vscode.workspace.getConfiguration('triton').get('sbtTestCommand', 'test'), 'sbt test')
  if (ok) vscode.window.showInformationMessage('Triton finished running sbt test.')
  return ok
}

async function runCoverageReport(folder = currentWorkspaceFolder()) {
  const runtimeBody = await runWorkspaceActionViaRuntime(folder, 'sbt-coverage')
  const ok = runtimeBody
    ? runtimeBody.ok === true
    : await runSbtCommand(
        folder,
        vscode.workspace.getConfiguration('triton').get('sbtCoverageCommand', 'coverage; test; coverageReport'),
        'sbt coverageReport',
      )
  if (ok) vscode.window.showInformationMessage('Triton finished running the coverage command.')
  return ok
}

function scheduleCommitRefresh(folder) {
  if (!folder) return
  const config = vscode.workspace.getConfiguration('triton', folder)
  if (!config.get('refreshOnCommit', false)) return
  const key = folder.uri.toString()
  clearCommitRefreshTimer(key)
  const out = outputChannel()
  const timer = setTimeout(() => {
    commitRefreshTimers.delete(key)
    out.appendLine(
      `[${new Date().toISOString()}] Git commit change detected for ${folder.name}; refreshing Triton.`,
    )
    void openDiagram({ folder, refreshToken: Date.now() })
  }, 500)
  commitRefreshTimers.set(key, timer)
}

function registerCommitRefreshWatchers(context) {
  const folders = vscode.workspace.workspaceFolders ?? []
  for (const folder of folders) {
    const gitHeadPattern = new vscode.RelativePattern(folder, '.git/HEAD')
    const gitRefsPattern = new vscode.RelativePattern(folder, '.git/refs/heads/**')
    const headWatcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern)
    const refsWatcher = vscode.workspace.createFileSystemWatcher(gitRefsPattern)
    const onEvent = () => scheduleCommitRefresh(folder)
    headWatcher.onDidChange(onEvent, null, context.subscriptions)
    headWatcher.onDidCreate(onEvent, null, context.subscriptions)
    refsWatcher.onDidChange(onEvent, null, context.subscriptions)
    refsWatcher.onDidCreate(onEvent, null, context.subscriptions)
    context.subscriptions.push(headWatcher, refsWatcher)
  }
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
  registerCommitRefreshWatchers(context)

  context.subscriptions.push(
    out,
    vscode.commands.registerCommand('triton.openDiagram', openDiagram),
    vscode.commands.registerCommand('triton.startServer', startServer),
    vscode.commands.registerCommand('triton.stopServer', stopServer),
    vscode.commands.registerCommand('triton.startRuntime', startRuntime),
    vscode.commands.registerCommand('triton.stopRuntime', stopRuntime),
    vscode.commands.registerCommand('triton.refreshDiagram', refreshDiagram),
    vscode.commands.registerCommand('triton.runSbtTest', () => runSbtTest()),
    vscode.commands.registerCommand('triton.runCoverageReport', () => runCoverageReport()),
    vscode.commands.registerCommand('triton.copyDiagramUrl', copyDiagramUrl),
    vscode.commands.registerCommand('triton.showServerUrl', showServerUrl),
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

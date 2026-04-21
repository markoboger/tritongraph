const http = require('http')
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const IGNORED_DIRS = new Set([
  '.git',
  '.idea',
  '.bloop',
  '.metals',
  '.scala-build',
  'node_modules',
  'dist',
  'out',
])

function applyCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function sendJson(res, statusCode, body) {
  const text = JSON.stringify(body, null, 2)
  applyCorsHeaders(res)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return null
  }
}

function fileExists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function probeWorkspace(workspacePath) {
  const root = String(workspacePath || '').trim()
  if (!root) {
    return {
      workspacePath: '',
      kind: 'none',
      hasBuildSbt: false,
      hasProjectDir: false,
      hasScalaSources: false,
    }
  }
  const buildFile = path.join(root, 'build.sbt')
  const projectDir = path.join(root, 'project')
  const scalaMain = path.join(root, 'src', 'main', 'scala')
  const scalaTest = path.join(root, 'src', 'test', 'scala')
  const hasBuildSbt = fileExists(buildFile)
  const hasProjectDir = fileExists(projectDir)
  const hasScalaSources = fileExists(scalaMain) || fileExists(scalaTest)
  return {
    workspacePath: root,
    kind: hasBuildSbt || hasProjectDir || hasScalaSources ? 'scala-sbt' : 'generic',
    hasBuildSbt,
    hasProjectDir,
    hasScalaSources,
  }
}

function readUtf8IfFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf8') : null
  } catch {
    return null
  }
}

function newestPath(paths) {
  let best = null
  let bestMtimeMs = -1
  for (const p of paths) {
    try {
      const stat = fs.statSync(p)
      if (!stat.isFile()) continue
      if (stat.mtimeMs > bestMtimeMs) {
        best = p
        bestMtimeMs = stat.mtimeMs
      }
    } catch {
      // Ignore unreadable candidates.
    }
  }
  return best
}

function normalizeRelPath(workspacePath, filePath) {
  return path.relative(workspacePath, filePath).split(path.sep).join('/')
}

function collectScalaFiles(workspacePath) {
  const out = []
  const seen = new Set()

  function walk(dirPath) {
    let entries = []
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        walk(absPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.scala')) continue
      const relPath = normalizeRelPath(workspacePath, absPath)
      if (seen.has(relPath)) continue
      const source = readUtf8IfFile(absPath)
      if (source == null) continue
      seen.add(relPath)
      out.push({ relPath, source })
    }
  }

  walk(workspacePath)
  out.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return out
}

function findScoverageReport(workspacePath) {
  const targetDir = path.join(workspacePath, 'target')
  let scalaDirs = []
  try {
    scalaDirs = fs
      .readdirSync(targetDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('scala-'))
      .map((d) => path.join(targetDir, d.name, 'scoverage-report', 'scoverage.xml'))
  } catch {
    return null
  }
  const best = newestPath(scalaDirs)
  if (!best) return null
  const xml = readUtf8IfFile(best)
  if (xml == null) return null
  return {
    relPath: normalizeRelPath(workspacePath, best),
    xml,
  }
}

function findSbtTestLog(workspacePath) {
  const direct = path.join(workspacePath, 'sbt-test.log')
  const directText = readUtf8IfFile(direct)
  if (directText != null) {
    return {
      relPath: 'sbt-test.log',
      text: directText,
    }
  }

  const candidates = []
  function walk(dirPath, depth) {
    if (depth > 4) return
    let entries = []
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        walk(absPath, depth + 1)
        continue
      }
      if (!entry.isFile() || entry.name !== 'sbt-test.log') continue
      candidates.push(absPath)
    }
  }
  walk(workspacePath, 0)
  const best = newestPath(candidates)
  if (!best) return null
  const text = readUtf8IfFile(best)
  if (text == null) return null
  return {
    relPath: normalizeRelPath(workspacePath, best),
    text,
  }
}

function readWorkspaceBundle(workspacePath) {
  const root = String(workspacePath || '').trim()
  const probe = probeWorkspace(root)
  const buildSbtPath = path.join(root, 'build.sbt')
  const buildSbtSource = readUtf8IfFile(buildSbtPath)
  return {
    ok: true,
    workspacePath: root,
    workspaceName: path.basename(root) || root,
    probe,
    buildSbt: buildSbtSource == null
      ? null
      : {
          relPath: 'build.sbt',
          source: buildSbtSource,
        },
    scalaFiles: collectScalaFiles(root),
    testLog: findSbtTestLog(root),
    coverageReport: findScoverageReport(root),
  }
}

function commandForAction(action, body) {
  if (action === 'refresh') return null
  if (action === 'sbt-test') {
    const executable = String(body.sbtExecutable || 'sbt').trim() || 'sbt'
    const command = String(body.sbtTestCommand || 'test').trim() || 'test'
    return `${executable} "${command.replaceAll('"', '\\"')}"`
  }
  if (action === 'sbt-coverage') {
    const executable = String(body.sbtExecutable || 'sbt').trim() || 'sbt'
    const command = String(body.sbtCoverageCommand || 'coverage; test; coverageReport').trim() || 'coverage; test; coverageReport'
    return `${executable} "${command.replaceAll('"', '\\"')}"`
  }
  return undefined
}

function runShellCommand(command, cwd) {
  return new Promise((resolve) => {
    cp.exec(command, { cwd }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error && typeof error.code === 'number' ? error.code : 0,
        stdout: stdout || '',
        stderr: stderr || '',
      })
    })
  })
}

async function handleWorkspaceAction(body) {
  const action = String(body.action || '').trim()
  const workspacePath = String(body.workspacePath || '').trim()
  const probe = probeWorkspace(workspacePath)
  if (!action) {
    return { statusCode: 400, body: { ok: false, error: 'missing_action' } }
  }
  if (!workspacePath) {
    return { statusCode: 400, body: { ok: false, error: 'missing_workspace_path' } }
  }

  const command = commandForAction(action, body)
  if (command === undefined) {
    return { statusCode: 400, body: { ok: false, error: 'unsupported_action', action } }
  }
  if (action === 'refresh') {
    return {
      statusCode: 200,
      body: {
        ok: true,
        action,
        probe,
        runtime: 'triton-runtime',
        note: 'Refresh is a no-op placeholder until live workspace ingestion is connected.',
      },
    }
  }

  const result = await runShellCommand(command, workspacePath)
  return {
    statusCode: result.ok ? 200 : 500,
    body: {
      ok: result.ok,
      action,
      command,
      probe,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  }
}

function createRuntimeServer() {
  return http.createServer(async (req, res) => {
    const method = req.method || 'GET'
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (method === 'OPTIONS') {
      applyCorsHeaders(res)
      res.writeHead(204)
      res.end()
      return
    }

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'triton-runtime',
        version: '0.1.0',
      })
      return
    }

    if (method === 'GET' && url.pathname === '/api/workspace/bundle') {
      const workspacePath = String(url.searchParams.get('workspacePath') || '').trim()
      if (!workspacePath) {
        sendJson(res, 400, { ok: false, error: 'missing_workspace_path' })
        return
      }
      sendJson(res, 200, readWorkspaceBundle(workspacePath))
      return
    }

    if (method === 'POST' && url.pathname === '/api/workspace/action') {
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const result = await handleWorkspaceAction(body)
      sendJson(res, result.statusCode, result.body)
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: 'not_found',
      method,
      path: url.pathname,
    })
  })
}

function startRuntimeServer(options = {}) {
  const host = String(options.host || '127.0.0.1')
  const port = Number(options.port || 4317)
  const server = createRuntimeServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve({
        server,
        host,
        port,
        url: `http://${host}:${port}`,
      })
    })
  })
}

module.exports = {
  createRuntimeServer,
  probeWorkspace,
  readWorkspaceBundle,
  startRuntimeServer,
}

const http = require('http')
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const os = require('os')
const crypto = require('crypto')
const { createPersistence } = require('./persistence')

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
const REPO_DISCOVERY_MAX_DEPTH = 3
const RUNTIME_VERSION = '0.7.1'

function applyCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function runtimeCapabilities(config) {
  const caps = ['analysis-local', 'analysis-github', 'github-sync']
  if (typeof config.persistence.listCourses === 'function') caps.push('courses-api')
  if (
    typeof config.persistence.registerRepoWebhook === 'function' &&
    typeof config.persistence.tryClaimWebhookDelivery === 'function'
  ) {
    caps.push('webhooks-github')
  }
  return caps
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

function collectBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function safeJsonScriptText(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function fileExists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
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

function splitConfiguredRoots(raw) {
  return String(raw || '')
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function normalizePathForCompare(value) {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function pathIsInsideRoot(candidatePath, rootPath) {
  const candidate = normalizePathForCompare(candidatePath)
  const root = normalizePathForCompare(rootPath)
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function runtimeConfig(options = {}) {
  const envAllowed = splitConfiguredRoots(process.env.TRITON_ALLOWED_REPO_ROOTS)
  const optAllowed = Array.isArray(options.allowedRepoRoots)
    ? options.allowedRepoRoots.map((entry) => String(entry || '').trim()).filter(Boolean)
    : []
  const allowedRepoRoots = (optAllowed.length ? optAllowed : envAllowed).map((root) => path.resolve(root))
  const publicRuntimeUrl = String(
    options.publicRuntimeUrl ||
      process.env.TRITON_PUBLIC_RUNTIME_URL ||
      (options.host && options.port ? `http://${options.host}:${options.port}` : ''),
  ).trim()
  const editorUrl = String(options.editorUrl || process.env.TRITON_EDITOR_URL || 'http://127.0.0.1:5173')
    .trim()
    .replace(/\/$/, '')
  const stateDir = path.resolve(
    String(options.stateDir || process.env.TRITON_RUNTIME_STATE_DIR || path.join(os.homedir(), '.triton-runtime')).trim(),
  )
  const gitCacheRoot = path.resolve(
    String(options.gitCacheRoot || process.env.TRITON_GIT_CACHE_ROOT || path.join(stateDir, 'github-cache')).trim(),
  )
  const httpPathPrefix = String(options.httpPathPrefix ?? process.env.TRITON_HTTP_PATH_PREFIX ?? '').trim()
  const persistenceBackendRaw = String(
    options.persistenceBackend ?? process.env.TRITON_PERSISTENCE_BACKEND ?? 'file',
  )
    .trim()
    .toLowerCase()
  const persistenceBackend = persistenceBackendRaw === 'postgres' ? 'postgres' : 'file'
  const databaseUrl = String(options.databaseUrl ?? process.env.DATABASE_URL ?? '').trim()
  return {
    allowedRepoRoots,
    publicRuntimeUrl,
    editorUrl,
    stateDir,
    gitCacheRoot,
    httpPathPrefix,
    persistenceBackend,
    databaseUrl,
  }
}

function validateWorkspacePath(workspacePath, config) {
  const input = String(workspacePath || '').trim()
  if (!input) {
    return { ok: false, statusCode: 400, error: 'missing_workspace_path' }
  }
  if (!path.isAbsolute(input)) {
    return { ok: false, statusCode: 400, error: 'workspace_path_must_be_absolute', workspacePath: input }
  }
  let realPath
  try {
    realPath = fs.realpathSync(input)
  } catch {
    return { ok: false, statusCode: 404, error: 'workspace_path_not_found', workspacePath: input }
  }
  let stat
  try {
    stat = fs.statSync(realPath)
  } catch {
    return { ok: false, statusCode: 404, error: 'workspace_path_not_found', workspacePath: input }
  }
  if (!stat.isDirectory()) {
    return { ok: false, statusCode: 400, error: 'workspace_path_not_directory', workspacePath: realPath }
  }
  if (config.allowedRepoRoots.length) {
    const insideConfiguredRoots = config.allowedRepoRoots.some((root) => pathIsInsideRoot(realPath, root))
    const insideGitCache =
      config.gitCacheRoot && pathIsInsideRoot(realPath, path.resolve(config.gitCacheRoot))
    if (!insideConfiguredRoots && !insideGitCache) {
      return {
        ok: false,
        statusCode: 403,
        error: 'workspace_path_not_allowed',
        workspacePath: realPath,
        allowedRepoRoots: config.allowedRepoRoots,
      }
    }
  }
  return { ok: true, workspacePath: realPath }
}

function validateWorkspaceRelativeFile(workspacePath, relPath) {
  const root = String(workspacePath || '').trim()
  const rel = String(relPath || '').trim()
  if (!root) return { ok: false, statusCode: 400, error: 'missing_workspace_path' }
  if (!rel) return { ok: false, statusCode: 400, error: 'missing_rel_path' }
  const normalizedRel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  const absPath = path.resolve(root, normalizedRel)
  if (!pathIsInsideRoot(absPath, root)) {
    return { ok: false, statusCode: 403, error: 'source_path_not_allowed', relPath: normalizedRel }
  }
  let stat
  try {
    stat = fs.statSync(absPath)
  } catch {
    return { ok: false, statusCode: 404, error: 'source_path_not_found', relPath: normalizedRel }
  }
  if (!stat.isFile()) {
    return { ok: false, statusCode: 400, error: 'source_path_not_file', relPath: normalizedRel }
  }
  return { ok: true, absPath, relPath: normalizedRel }
}

function readUtf8IfFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf8') : null
  } catch {
    return null
  }
}

function repoDisplayName(repoPath) {
  return path.basename(repoPath) || repoPath
}

function repoMetadata(repoPath) {
  const probe = probeWorkspace(repoPath)
  return {
    workspacePath: repoPath,
    workspaceName: repoDisplayName(repoPath),
    probe,
  }
}

function enrichRecentRepoRows(rows) {
  return rows
    .map((entry) => {
      const repoPath = String(entry.workspacePath || '').trim()
      if (!repoPath || !fileExists(repoPath)) return null
      const base = {
        workspacePath: repoPath,
        workspaceName:
          String(entry.workspaceName || repoDisplayName(repoPath)).trim() || repoDisplayName(repoPath),
        lastOpenedAt: String(entry.lastOpenedAt || '').trim(),
        probe: probeWorkspace(repoPath),
      }
      if (entry.source === 'github' || entry.source === 'gitlab') {
        base.source = entry.source
        const ru = String(entry.repositoryUrl || '').trim()
        if (ru) base.repositoryUrl = ru
        const gr = String(entry.gitRef || '').trim()
        if (gr) base.gitRef = gr
      }
      return base
    })
    .filter(Boolean)
}

async function loadRecentReposForHome(config) {
  const rows = await config.persistence.listRecentRepositories()
  return enrichRecentRepoRows(rows)
}

async function validateOptionalCourseId(config, courseIdRaw) {
  const courseId = String(courseIdRaw || '').trim()
  if (!courseId) return { ok: true, courseId: '' }
  if (typeof config.persistence.getCourse !== 'function') {
    return { ok: false, error: 'courses_not_supported' }
  }
  const c = await config.persistence.getCourse(courseId)
  if (!c) return { ok: false, error: 'course_not_found' }
  return { ok: true, courseId }
}

async function loadCoursesForHome(config) {
  const p = config.persistence
  if (typeof p.listCourses !== 'function' || typeof p.listWorkspacesForCourse !== 'function') {
    return []
  }
  const list = await p.listCourses()
  const out = []
  for (const c of list) {
    const links = await p.listWorkspacesForCourse(c.id)
    const rows = links.map((l) => ({
      workspacePath: l.workspacePath,
      workspaceName: l.workspaceName,
      lastOpenedAt: l.linkedAt,
      source: l.source,
      repositoryUrl: l.repositoryUrl,
      gitRef: l.gitRef,
    }))
    const workspaces = enrichRecentRepoRows(rows)
    out.push({ ...c, workspaces })
  }
  return out
}

function filterOrphanRecentRepos(recentList, coursesPayload) {
  const assigned = new Set()
  for (const c of coursesPayload) {
    for (const w of c.workspaces || []) {
      const p = String(w.workspacePath || '').trim()
      if (p) assigned.add(p)
    }
  }
  return recentList.filter((r) => !assigned.has(String(r.workspacePath || '').trim()))
}

async function rememberRecentRepo(config, workspacePath, workspaceName, extras = {}) {
  const row = {
    workspacePath,
    workspaceName: workspaceName || repoDisplayName(workspacePath),
    lastOpenedAt: new Date().toISOString(),
  }
  if (extras.source === 'github' || extras.source === 'gitlab') {
    row.source = extras.source
    if (extras.repositoryUrl) row.repositoryUrl = String(extras.repositoryUrl).trim()
    if (extras.gitRef) row.gitRef = String(extras.gitRef).trim()
  }
  await config.persistence.recordRecentRepository(row)
}

function directoryLooksLikeRepo(dirPath) {
  return (
    fileExists(path.join(dirPath, '.git')) ||
    fileExists(path.join(dirPath, 'build.sbt')) ||
    fileExists(path.join(dirPath, 'project')) ||
    fileExists(path.join(dirPath, 'package.json')) ||
    fileExists(path.join(dirPath, 'pom.xml')) ||
    fileExists(path.join(dirPath, 'src'))
  )
}

function discoverReposUnderRoot(rootPath, maxDepth = REPO_DISCOVERY_MAX_DEPTH) {
  const repos = []
  const seen = new Set()

  function visit(dirPath, depth) {
    let stat
    try {
      stat = fs.statSync(dirPath)
    } catch {
      return
    }
    if (!stat.isDirectory()) return
    if (seen.has(dirPath)) return
    seen.add(dirPath)

    if (directoryLooksLikeRepo(dirPath)) {
      repos.push(repoMetadata(dirPath))
      return
    }
    if (depth >= maxDepth) return

    let entries = []
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (IGNORED_DIRS.has(entry.name)) continue
      visit(path.join(dirPath, entry.name), depth + 1)
    }
  }

  visit(rootPath, 0)
  repos.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.workspacePath.localeCompare(b.workspacePath))
  return repos
}

function discoverAllowedRepos(config) {
  if (!config.allowedRepoRoots.length) return []
  const out = []
  const seen = new Set()
  for (const root of config.allowedRepoRoots) {
    for (const repo of discoverReposUnderRoot(root)) {
      if (seen.has(repo.workspacePath)) continue
      seen.add(repo.workspacePath)
      out.push(repo)
    }
  }
  out.sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.workspacePath.localeCompare(b.workspacePath))
  return out
}

async function apiHomeModel(config) {
  const courses = await loadCoursesForHome(config)
  const recentAll = await loadRecentReposForHome(config)
  return {
    ok: true,
    runtime: {
      publicRuntimeUrl: config.publicRuntimeUrl,
      editorUrl: config.editorUrl,
      allowedRepoRoots: config.allowedRepoRoots,
      gitCacheRoot: config.gitCacheRoot,
      httpPathPrefix: config.httpPathPrefix || undefined,
      persistenceBackend: config.persistence.kind,
      capabilities: runtimeCapabilities(config),
      version: RUNTIME_VERSION,
    },
    courses,
    recentRepos: filterOrphanRecentRepos(recentAll, courses),
    discoveredRepos: discoverAllowedRepos(config),
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
  const candidates = []

  function walk(dirPath, depth) {
    if (depth > 3) return
    let entries = []
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (IGNORED_DIRS.has(entry.name)) continue
      const abs = path.join(dirPath, entry.name)
      if (entry.name === 'target') {
        let scalaDirs = []
        try {
          scalaDirs = fs
            .readdirSync(abs, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith('scala-'))
            .map((d) => path.join(abs, d.name, 'scoverage-report', 'scoverage.xml'))
        } catch {
          scalaDirs = []
        }
        for (const p of scalaDirs) candidates.push(p)
        continue
      }
      walk(abs, depth + 1)
    }
  }

  walk(workspacePath, 0)
  const best = newestPath(candidates)
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

const GIT_CLONE_TIMEOUT_MS = Number(process.env.TRITON_GIT_CLONE_TIMEOUT_MS || 180000)

/**
 * HTTPS Git auth via Authorization Basic (token never embedded in remote URL).
 * GitHub: x-access-token:<pat>. GitLab (and compatible hosts): oauth2:<pat>.
 */
function gitAuthConfigArgs(host, token) {
  const t = String(token || '').trim()
  if (!t) return []
  const h = String(host || '').toLowerCase()
  const userPass = h === 'github.com' ? `x-access-token:${t}` : `oauth2:${t}`
  const basic = Buffer.from(userPass, 'utf8').toString('base64')
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`]
}

function execGit(args, options = {}) {
  const prefix = gitAuthConfigArgs(options.authHost, options.token)
  const mergedArgs = [...prefix, ...args]
  return new Promise((resolve) => {
    cp.execFile(
      'git',
      mergedArgs,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? GIT_CLONE_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          exitCode: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      },
    )
  })
}

function remoteGitTokenFromRequest(body, req) {
  const auth = req.headers?.authorization
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, '').trim()
    if (t) return t
  }
  const xtGh = req.headers?.['x-github-token']
  if (typeof xtGh === 'string' && xtGh.trim()) return xtGh.trim()
  if (Array.isArray(xtGh) && xtGh[0]) return String(xtGh[0]).trim()
  const xtGl = req.headers?.['x-gitlab-token']
  if (typeof xtGl === 'string' && xtGl.trim()) return xtGl.trim()
  if (Array.isArray(xtGl) && xtGl[0]) return String(xtGl[0]).trim()
  const fromGeneric = String(body?.gitToken || '').trim()
  if (fromGeneric) return fromGeneric
  const fromGh = String(body?.githubToken || '').trim()
  if (fromGh) return fromGh
  const fromGl = String(body?.gitlabToken || '').trim()
  if (fromGl) return fromGl
  const envGh = String(process.env.TRITON_GITHUB_TOKEN || '').trim()
  if (envGh) return envGh
  return String(process.env.TRITON_GITLAB_TOKEN || '').trim()
}

function parseExtraGitHostsSet() {
  const raw = String(process.env.TRITON_EXTRA_GIT_HOSTS || '').trim()
  if (!raw) return new Set()
  return new Set(raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))
}

function gitUrlPathSegmentInvalid(seg) {
  const s = String(seg || '').trim()
  if (!s || s === '.' || s === '..') return true
  return /[/\\\x00-\x1f]/.test(s)
}

function parseHostedGitHttpsUrl(input) {
  const trimmed = String(input || '').trim()
  if (!trimmed) {
    return { ok: false, error: 'missing_repository_url' }
  }
  let urlString = trimmed
  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString.replace(/^\/+/, '')}`
  }
  let u
  try {
    u = new URL(urlString)
  } catch {
    return { ok: false, error: 'invalid_repository_url' }
  }
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'only_https_repository_urls_supported' }
  }
  const host = u.hostname.toLowerCase()
  const extraHosts = parseExtraGitHostsSet()
  const isGithub = host === 'github.com'
  const isGitlab = host === 'gitlab.com' || extraHosts.has(host)
  if (!isGithub && !isGitlab) {
    return {
      ok: false,
      error: 'unsupported_git_host',
      hint: 'Use https://github.com/… or https://gitlab.com/…. Self-hosted GitLab: set TRITON_EXTRA_GIT_HOSTS to your hostname.',
    }
  }

  const parts = u.pathname
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => p.replace(/\.git$/i, ''))

  if (parts.some(gitUrlPathSegmentInvalid)) {
    return { ok: false, error: 'invalid_repository_path' }
  }

  if (parts.length < 2) {
    return { ok: false, error: 'repository_url_need_namespace_and_project' }
  }

  if (isGithub) {
    if (parts.length !== 2) {
      return { ok: false, error: 'github_url_need_owner_repo' }
    }
    if (parts[0] === 'orgs' || parts[0] === 'organizations') {
      return {
        ok: false,
        error: 'github_org_list_url_not_repo',
        hint: 'Open a single repository and copy its URL, e.g. https://github.com/owner/repo-name',
      }
    }
    const owner = parts[0]
    const repo = parts[1]
    if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
      return { ok: false, error: 'invalid_owner_or_repo' }
    }
    const cloneUrl = `https://github.com/${owner}/${repo}.git`
    const canonicalRepoUrl = `https://github.com/${owner}/${repo}`
    return {
      ok: true,
      host,
      segments: [owner, repo],
      cloneUrl,
      canonicalRepoUrl,
      provider: 'github',
    }
  }

  const pathStr = parts.join('/')
  const cloneUrl = `https://${host}/${pathStr}.git`
  const canonicalRepoUrl = `https://${host}/${pathStr}`
  return {
    ok: true,
    host,
    segments: parts,
    cloneUrl,
    canonicalRepoUrl,
    provider: 'gitlab',
  }
}

function hostedGitCloneDestPath(config, host, segments) {
  const root = path.resolve(config.gitCacheRoot)
  const hostDir = host.replace(/[^a-zA-Z0-9_.-]/g, '_')
  let cur = path.join(root, hostDir)
  for (const seg of segments) {
    const safe = String(seg).replace(/[^a-zA-Z0-9_.@-]/g, '_')
    if (!safe || safe === '.' || safe === '..') {
      return null
    }
    cur = path.join(cur, safe)
  }
  return cur
}

function gitMaterializeFailure(gitResult, errorCode = 'git_clone_failed') {
  const tail = gitResult.stderr.trim() || gitResult.stdout.trim() || `exit ${gitResult.exitCode}`
  return {
    ok: false,
    statusCode: 502,
    body: {
      ok: false,
      error: errorCode,
      detail: tail.slice(-4000),
    },
  }
}

async function materializeGithubRepo(body, config, token = '') {
  const parsed = parseHostedGitHttpsUrl(body.repositoryUrl)
  if (!parsed.ok) {
    const errBody = { ok: false, error: parsed.error }
    if (parsed.hint) errBody.hint = parsed.hint
    return { ok: false, statusCode: 400, body: errBody }
  }
  const refRequested = String(body.ref || '').trim()
  const dest = hostedGitCloneDestPath(config, parsed.host, parsed.segments)
  if (!dest) {
    return { ok: false, statusCode: 400, body: { ok: false, error: 'invalid_repository_path' } }
  }
  const gitTok = { token, timeoutMs: GIT_CLONE_TIMEOUT_MS, authHost: parsed.host }
  const gitMetaPath = path.join(dest, '.git')
  const workspaceLabel = parsed.segments[parsed.segments.length - 1]

  ensureDirSync(path.dirname(dest))

  if (fileExists(gitMetaPath)) {
    const setRemote = await execGit(['-C', dest, 'remote', 'set-url', 'origin', parsed.cloneUrl], gitTok)
    if (!setRemote.ok) return gitMaterializeFailure(setRemote, 'git_remote_failed')
    if (refRequested) {
      const fetchRef = await execGit(['-C', dest, 'fetch', 'origin', refRequested, '--depth', '1'], gitTok)
      if (!fetchRef.ok) return gitMaterializeFailure(fetchRef)
      const checkout = await execGit(['-C', dest, 'checkout', '-f', 'FETCH_HEAD'], gitTok)
      if (!checkout.ok) return gitMaterializeFailure(checkout)
    } else {
      const pull = await execGit(['-C', dest, 'pull', '--ff-only', '--depth', '1'], gitTok)
      if (!pull.ok) return gitMaterializeFailure(pull)
    }
  } else {
    try {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true })
      }
    } catch (err) {
      return {
        ok: false,
        statusCode: 500,
        body: {
          ok: false,
          error: 'git_cache_remove_failed',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
    const cloneArgs = ['clone', '--depth', '1']
    if (refRequested) {
      cloneArgs.push('--branch', refRequested)
    }
    cloneArgs.push(parsed.cloneUrl, dest)
    const gitResult = await execGit(cloneArgs, gitTok)
    if (!gitResult.ok) return gitMaterializeFailure(gitResult)
  }

  let realPath
  try {
    realPath = fs.realpathSync(dest)
  } catch (err) {
    return {
      ok: false,
      statusCode: 500,
      body: {
        ok: false,
        error: 'clone_path_unreadable',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
  return {
    ok: true,
    workspacePath: realPath,
    workspaceName: workspaceLabel,
    canonicalRepoUrl: parsed.canonicalRepoUrl,
    refRequested,
    provider: parsed.provider,
  }
}

function buildAnalysisSuccessBody(workspacePath, workspaceName, probe, config, extras = {}) {
  const analysisId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    ok: true,
    analysisId,
    workspacePath,
    workspaceName,
    probe,
    bundleUrl: `${config.publicRuntimeUrl || ''}/api/workspace/bundle?workspacePath=${encodeURIComponent(workspacePath)}`,
    launch: runtimeWorkspaceLaunchUrls(workspacePath, workspaceName, config),
    ...extras,
  }
}

function runtimeWorkspaceLaunchUrls(workspacePath, workspaceName, config) {
  const runtimeUrl = config.publicRuntimeUrl || ''
  const editorUrl = config.editorUrl || ''
  if (!runtimeUrl || !editorUrl) {
    return {
      runtimeUrl,
      editorUrl,
      sbtDiagramUrl: '',
      packagesDiagramUrl: '',
    }
  }
  const sbt = new URL(editorUrl)
  sbt.searchParams.set('runtimeUrl', runtimeUrl)
  sbt.searchParams.set('workspaceFolder', workspacePath)
  sbt.searchParams.set('workspaceName', workspaceName)

  const packages = new URL(sbt.toString())
  packages.searchParams.set('tab', `runtime-packages:${workspacePath}::${workspaceName}`)
  return {
    runtimeUrl,
    editorUrl,
    sbtDiagramUrl: sbt.toString(),
    packagesDiagramUrl: packages.toString(),
  }
}

async function analyzeLocalWorkspace(body, config) {
  const courseCheck = await validateOptionalCourseId(config, body.courseId)
  if (!courseCheck.ok) {
    return { statusCode: 400, body: { ok: false, error: courseCheck.error } }
  }
  const validation = validateWorkspacePath(body.workspacePath, config)
  if (!validation.ok) {
    return {
      statusCode: validation.statusCode,
      body: { ok: false, error: validation.error, workspacePath: validation.workspacePath, allowedRepoRoots: validation.allowedRepoRoots },
    }
  }
  const workspacePath = validation.workspacePath
  const probe = probeWorkspace(workspacePath)
  const workspaceName =
    String(body.workspaceName || '').trim() || path.basename(workspacePath) || path.basename(path.dirname(workspacePath)) || 'workspace'
  await rememberRecentRepo(config, workspacePath, workspaceName)
  if (courseCheck.courseId && typeof config.persistence.attachWorkspaceToCourse === 'function') {
    await config.persistence.attachWorkspaceToCourse({
      courseId: courseCheck.courseId,
      workspacePath,
      workspaceName,
    })
  }
  return {
    statusCode: 200,
    body: buildAnalysisSuccessBody(workspacePath, workspaceName, probe, config, { mode: 'local-path' }),
  }
}

async function registerGithubWorkspace(body, config, token, mode) {
  const courseCheck = await validateOptionalCourseId(config, body.courseId)
  if (!courseCheck.ok) {
    return { statusCode: 400, body: { ok: false, error: courseCheck.error } }
  }
  const materialized = await materializeGithubRepo(body, config, token)
  if (!materialized.ok) {
    return { statusCode: materialized.statusCode, body: materialized.body }
  }
  const workspacePath = materialized.workspacePath
  const workspaceName =
    String(body.workspaceName || '').trim() || materialized.workspaceName || path.basename(workspacePath) || 'workspace'
  const validation = validateWorkspacePath(workspacePath, config)
  if (!validation.ok) {
    return {
      statusCode: validation.statusCode,
      body: {
        ok: false,
        error: validation.error,
        workspacePath: validation.workspacePath,
        allowedRepoRoots: validation.allowedRepoRoots,
      },
    }
  }
  const resolvedPath = validation.workspacePath
  const remoteSource = materialized.provider === 'github' ? 'github' : 'gitlab'
  await rememberRecentRepo(config, resolvedPath, workspaceName, {
    source: remoteSource,
    repositoryUrl: materialized.canonicalRepoUrl,
    gitRef: materialized.refRequested || undefined,
  })
  if (courseCheck.courseId && typeof config.persistence.attachWorkspaceToCourse === 'function') {
    await config.persistence.attachWorkspaceToCourse({
      courseId: courseCheck.courseId,
      workspacePath: resolvedPath,
      workspaceName,
      repositoryUrl: materialized.canonicalRepoUrl,
      gitRef: materialized.refRequested || undefined,
      source: remoteSource,
    })
  }
  const probe = probeWorkspace(resolvedPath)
  return {
    statusCode: 200,
    body: buildAnalysisSuccessBody(resolvedPath, workspaceName, probe, config, {
      mode,
      repositoryUrl: materialized.canonicalRepoUrl,
      gitRef: materialized.refRequested || undefined,
    }),
  }
}

function normalizeWebhookBranch(value) {
  let s = String(value ?? 'main').trim()
  if (!s) s = 'main'
  if (s.startsWith('refs/heads/')) s = s.slice('refs/heads/'.length)
  return s
}

function webhookAdminAuthorized(req) {
  const required = String(process.env.TRITON_WEBHOOK_ADMIN_TOKEN || '').trim()
  if (!required) return true
  const auth = req.headers?.authorization
  if (typeof auth !== 'string' || !/^Bearer\s+/i.test(auth)) return false
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (token.length !== required.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(required, 'utf8'))
  } catch {
    return false
  }
}

function verifyGithubSignature256(rawBody, secret, sigHeader) {
  if (!secret || typeof sigHeader !== 'string') return false
  const expected =
    'sha256=' + crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex')
  const got = String(sigHeader).trim()
  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(got, 'utf8')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function stripLeadingUtf8Bom(buf) {
  if (!buf || buf.length < 3) return buf
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3)
  return buf
}

/**
 * GitHub usually sends repository.clone_url; ping and some payloads omit it — fall back to html_url or full_name.
 * Signature verification must use the raw request body unchanged; BOM stripping is only for JSON parsing.
 */
function githubRepositoryHttpsCloneUrl(repo) {
  if (!repo || typeof repo !== 'object') return ''
  const direct = typeof repo.clone_url === 'string' ? repo.clone_url.trim() : ''
  if (direct) return direct
  const html = typeof repo.html_url === 'string' ? repo.html_url.trim() : ''
  if (html && /^https:\/\//i.test(html)) {
    const base = html.replace(/\/+$/, '')
    return base.toLowerCase().endsWith('.git') ? base : `${base}.git`
  }
  const fn = typeof repo.full_name === 'string' ? repo.full_name.trim() : ''
  if (fn && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(fn)) {
    return `https://github.com/${fn}.git`
  }
  return ''
}

function parseGithubWebhookPayload(rawBuf) {
  const stripped = stripLeadingUtf8Bom(rawBuf || Buffer.alloc(0))
  const text = stripped.length ? stripped.toString('utf8') : ''
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'empty_body' }
  try {
    return { ok: true, payload: JSON.parse(trimmed) }
  } catch {
    try {
      const params = new URLSearchParams(trimmed)
      const payloadParam = params.get('payload')
      if (payloadParam) {
        return { ok: true, payload: JSON.parse(payloadParam) }
      }
    } catch {
      /* fall through */
    }
    return { ok: false, error: 'invalid_json' }
  }
}

function assertWorkspaceMatchesGitCache(workspacePath, parsed, config) {
  const dest = hostedGitCloneDestPath(config, parsed.host, parsed.segments)
  if (!dest) return { ok: false, error: 'invalid_repository_path' }
  const gitMeta = path.join(dest, '.git')
  if (!fileExists(gitMeta)) {
    return {
      ok: false,
      error: 'clone_not_found',
      hint: 'Clone the repository once via the runtime UI or POST /api/analysis/github before registering a webhook.',
    }
  }
  let realDest
  try {
    realDest = fs.realpathSync(dest)
  } catch (err) {
    return {
      ok: false,
      error: 'clone_path_unreadable',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
  const ws = String(workspacePath || '').trim()
  if (normalizePathForCompare(ws) !== normalizePathForCompare(realDest)) {
    return {
      ok: false,
      error: 'workspace_path_must_match_git_cache',
      expectedWorkspacePath: realDest,
    }
  }
  return { ok: true }
}

/**
 * When workspacePath is omitted, uses the runtime git-cache path for this repo (after clone/analyze).
 */
function resolveGithubWebhookWorkspace(bodyWorkspacePath, parsed, config) {
  const wsInput = String(bodyWorkspacePath || '').trim()
  if (wsInput) {
    const validation = validateWorkspacePath(wsInput, config)
    if (!validation.ok) {
      return {
        ok: false,
        statusCode: validation.statusCode,
        body: {
          ok: false,
          error: validation.error,
          workspacePath: validation.workspacePath,
          allowedRepoRoots: validation.allowedRepoRoots,
        },
      }
    }
    const cacheCheck = assertWorkspaceMatchesGitCache(validation.workspacePath, parsed, config)
    if (!cacheCheck.ok) {
      return {
        ok: false,
        statusCode: 400,
        body: {
          ok: false,
          error: cacheCheck.error,
          ...(cacheCheck.hint ? { hint: cacheCheck.hint } : {}),
          ...(cacheCheck.expectedWorkspacePath ? { expectedWorkspacePath: cacheCheck.expectedWorkspacePath } : {}),
        },
      }
    }
    return { ok: true, workspacePath: validation.workspacePath }
  }

  const dest = hostedGitCloneDestPath(config, parsed.host, parsed.segments)
  if (!dest) {
    return {
      ok: false,
      statusCode: 400,
      body: { ok: false, error: 'invalid_repository_path' },
    }
  }
  const gitMeta = path.join(dest, '.git')
  if (!fileExists(gitMeta)) {
    return {
      ok: false,
      statusCode: 400,
      body: {
        ok: false,
        error: 'clone_not_found',
        hint: 'Clone the repository once via the runtime UI or POST /api/analysis/github before registering a webhook.',
      },
    }
  }
  let realDest
  try {
    realDest = fs.realpathSync(dest)
  } catch (err) {
    return {
      ok: false,
      statusCode: 500,
      body: {
        ok: false,
        error: 'clone_path_unreadable',
        detail: err instanceof Error ? err.message : String(err),
      },
    }
  }
  const validation = validateWorkspacePath(realDest, config)
  if (!validation.ok) {
    return {
      ok: false,
      statusCode: validation.statusCode,
      body: {
        ok: false,
        error: validation.error,
        workspacePath: validation.workspacePath,
        allowedRepoRoots: validation.allowedRepoRoots,
      },
    }
  }
  return { ok: true, workspacePath: validation.workspacePath }
}

async function apiRegisterGithubWebhook(body, config, req) {
  if (!webhookAdminAuthorized(req)) {
    return { statusCode: 403, body: { ok: false, error: 'webhook_admin_unauthorized' } }
  }
  if (typeof config.persistence.registerRepoWebhook !== 'function') {
    return { statusCode: 501, body: { ok: false, error: 'webhooks_not_supported' } }
  }
  const parsed = parseHostedGitHttpsUrl(body.repositoryUrl)
  if (!parsed.ok) {
    const errBody = { ok: false, error: parsed.error }
    if (parsed.hint) errBody.hint = parsed.hint
    return { statusCode: 400, body: errBody }
  }
  if (parsed.provider !== 'github') {
    return {
      statusCode: 400,
      body: { ok: false, error: 'github_webhooks_only_in_phase1', hint: 'GitLab ingress can follow the same pattern later.' },
    }
  }
  const resolved = resolveGithubWebhookWorkspace(body.workspacePath, parsed, config)
  if (!resolved.ok) {
    return { statusCode: resolved.statusCode, body: resolved.body }
  }
  const validationWorkspacePath = resolved.workspacePath
  const branch = normalizeWebhookBranch(body.branch)
  const workspaceName =
    String(body.workspaceName || '').trim() || path.basename(validationWorkspacePath) || 'workspace'
  const result = await config.persistence.registerRepoWebhook({
    canonicalRepositoryUrl: parsed.canonicalRepoUrl,
    workspacePath: validationWorkspacePath,
    workspaceName,
    branch,
    secret: body.secret ? String(body.secret).trim() : undefined,
    provider: 'github',
  })
  if (!result.ok) {
    return { statusCode: 400, body: { ok: false, error: result.error } }
  }
  const base = String(config.publicRuntimeUrl || '').replace(/\/$/, '')
  const webhookUrl = base ? `${base}/api/webhooks/github` : '/api/webhooks/github'
  return {
    statusCode: 200,
    body: {
      ok: true,
      secret: result.secret,
      webhook: result.webhook,
      webhookUrl,
      events: ['push'],
      contentType: 'application/json',
      docs: 'Local dev: use an HTTPS tunnel to this URL — see docs/webhooks-development.md',
    },
  }
}

async function apiDeleteGithubWebhook(body, config, req) {
  if (!webhookAdminAuthorized(req)) {
    return { statusCode: 403, body: { ok: false, error: 'webhook_admin_unauthorized' } }
  }
  if (typeof config.persistence.deleteRepoWebhook !== 'function') {
    return { statusCode: 501, body: { ok: false, error: 'webhooks_not_supported' } }
  }
  const parsed = parseHostedGitHttpsUrl(body.repositoryUrl)
  if (!parsed.ok) {
    const errBody = { ok: false, error: parsed.error }
    if (parsed.hint) errBody.hint = parsed.hint
    return { statusCode: 400, body: errBody }
  }
  const result = await config.persistence.deleteRepoWebhook(parsed.canonicalRepoUrl)
  if (!result.ok) {
    const code = result.error === 'webhook_not_found' ? 404 : 400
    return { statusCode: code, body: { ok: false, error: result.error } }
  }
  return { statusCode: 200, body: { ok: true } }
}

async function apiGithubWebhookIngress(rawBody, req, config) {
  if (
    typeof config.persistence.getRepoWebhook !== 'function' ||
    typeof config.persistence.tryClaimWebhookDelivery !== 'function'
  ) {
    return { statusCode: 501, body: { ok: false, error: 'webhooks_not_supported' } }
  }
  const event = String(req.headers['x-github-event'] || '').trim()
  const sig = req.headers['x-hub-signature-256']
  const deliveryId = String(req.headers['x-github-delivery'] || '').trim()

  const parsedPayload = parseGithubWebhookPayload(rawBody)
  if (!parsedPayload.ok) {
    return { statusCode: 400, body: { ok: false, error: parsedPayload.error } }
  }
  const payload = parsedPayload.payload

  const repo = payload.repository
  const cloneUrl = githubRepositoryHttpsCloneUrl(repo)
  if (!cloneUrl) {
    if (event === 'ping') {
      return {
        statusCode: 200,
        body: { ok: true, ignored: true, event: 'ping', reason: 'no_repository_clone_url_in_payload' },
      }
    }
    return { statusCode: 400, body: { ok: false, error: 'missing_repository_clone_url' } }
  }
  const parsed = parseHostedGitHttpsUrl(cloneUrl)
  if (!parsed.ok) {
    return { statusCode: 400, body: { ok: false, error: parsed.error } }
  }
  const hook = await config.persistence.getRepoWebhook(parsed.canonicalRepoUrl)
  if (!hook) {
    return { statusCode: 200, body: { ok: true, ignored: true, reason: 'no_registered_webhook' } }
  }
  if (!verifyGithubSignature256(rawBody, hook.secret, sig)) {
    return { statusCode: 401, body: { ok: false, error: 'invalid_signature' } }
  }

  if (
    !deliveryId ||
    !(await config.persistence.tryClaimWebhookDelivery(deliveryId, {
      provider: 'github',
      canonicalRepositoryUrl: parsed.canonicalRepoUrl,
    }))
  ) {
    return { statusCode: 200, body: { ok: true, duplicate: true } }
  }

  if (event !== 'push') {
    if (typeof config.persistence.finishWebhookDelivery === 'function') {
      await config.persistence.finishWebhookDelivery(deliveryId, 'ignored', `event:${event}`)
    }
    return { statusCode: 200, body: { ok: true, ignored: true, event } }
  }

  const ref = String(payload.ref || '').trim()
  const wantRef = `refs/heads/${hook.branch}`
  if (ref !== wantRef) {
    if (typeof config.persistence.finishWebhookDelivery === 'function') {
      await config.persistence.finishWebhookDelivery(deliveryId, 'ignored', `ref:${ref}`)
    }
    return { statusCode: 200, body: { ok: true, ignored: true, ref } }
  }

  const token = String(process.env.TRITON_GITHUB_TOKEN || '').trim()
  const sync = await registerGithubWorkspace(
    { repositoryUrl: parsed.cloneUrl, ref: hook.branch, workspaceName: hook.workspaceName },
    config,
    token,
    'github-sync',
  )

  if (typeof config.persistence.finishWebhookDelivery === 'function') {
    await config.persistence.finishWebhookDelivery(
      deliveryId,
      sync.statusCode === 200 ? 'synced' : 'sync_failed',
      sync.statusCode === 200 ? null : JSON.stringify(sync.body).slice(0, 1800),
    )
  }

  if (sync.statusCode !== 200) {
    return { statusCode: 200, body: { ok: false, error: 'sync_failed', detail: sync.body } }
  }
  return {
    statusCode: 200,
    body: {
      ok: true,
      synced: true,
      workspacePath: sync.body.workspacePath,
      repositoryUrl: parsed.canonicalRepoUrl,
      branch: hook.branch,
    },
  }
}

async function runtimeHomeHtml(config) {
  const home = await apiHomeModel(config)
  const allowedRoots = config.allowedRepoRoots.length
    ? `<ul>${config.allowedRepoRoots.map((root) => `<li><code>${escapeHtml(root)}</code></li>`).join('')}</ul>`
    : '<p><em>No root restriction configured.</em></p>'
  const editorUrl = config.editorUrl
    ? `<code>${escapeHtml(config.editorUrl)}</code>`
    : '<em>not configured</em>'
  const runtimeUrl = config.publicRuntimeUrl
    ? `<code>${escapeHtml(config.publicRuntimeUrl)}</code>`
    : '<em>not configured</em>'
  const placeholder = escapeHtml(path.join(os.homedir(), 'workspace', 'chess'))
  const bootstrapJson = safeJsonScriptText(home)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Triton Runtime</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 40%, #ecfeff 100%); color: #0f172a; }
    main { max-width: 1160px; margin: 0 auto; padding: 32px 20px 48px; }
    .stack { display: grid; gap: 20px; }
    .card { background: rgba(255, 255, 255, 0.96); border: 1px solid #cbd5e1; border-radius: 18px; padding: 20px; box-shadow: 0 14px 40px rgba(15, 23, 42, 0.07); }
    h1 { margin: 0 0 8px; font-size: 30px; }
    p { line-height: 1.5; }
    code { background: #e2e8f0; padding: 2px 6px; border-radius: 6px; }
    form { display: grid; gap: 12px; margin-top: 16px; }
    label { font-weight: 600; }
    input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #94a3b8; font: inherit; box-sizing: border-box; }
    button { width: fit-content; padding: 12px 18px; border: 0; border-radius: 10px; background: #0f766e; color: white; font: inherit; cursor: pointer; }
    button:hover { background: #115e59; }
    .button-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .button-secondary { background: #dbeafe; color: #1d4ed8; }
    .button-secondary:hover { background: #bfdbfe; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
    .columns { display: grid; grid-template-columns: 1.1fr 1fr; gap: 20px; }
    .section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .section-title h2 { margin: 0; font-size: 20px; }
    .repo-list { display: grid; gap: 12px; }
    .repo-item { border: 1px solid #dbe4f0; border-radius: 14px; padding: 14px; background: #ffffff; }
    .repo-item header { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .repo-item h3 { margin: 0 0 6px; font-size: 17px; }
    .repo-item p { margin: 4px 0; }
    .repo-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .repo-path { color: #334155; word-break: break-all; }
    .repo-meta { color: #475569; font-size: 14px; }
    .badge { display: inline-flex; align-items: center; padding: 4px 8px; border-radius: 999px; background: #ccfbf1; color: #115e59; font-size: 12px; font-weight: 700; }
    .empty { color: #64748b; font-style: italic; }
    .result { margin-top: 20px; display: none; }
    .result.visible { display: block; }
    .links { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
    .link { display: inline-block; padding: 10px 14px; border-radius: 10px; background: #dbeafe; color: #1d4ed8; text-decoration: none; font-weight: 600; }
    .error { color: #b91c1c; font-weight: 600; }
    pre { overflow: auto; white-space: pre-wrap; word-break: break-word; background: #f8fafc; border-radius: 12px; padding: 14px; border: 1px solid #e2e8f0; }
    @media (max-width: 960px) {
      .columns, .meta { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <div class="stack">
      <div class="card">
        <h1>Triton Runtime</h1>
        <p>Browse local repositories under the configured workspace roots, reopen recent repos, or analyze a path directly with the standalone Triton runtime.</p>
        <form id="analysis-form">
          <div>
            <label for="workspacePath">Local repository path</label>
            <input id="workspacePath" name="workspacePath" type="text" placeholder="${placeholder}" />
          </div>
          <div class="button-row">
            <button type="submit">Analyze Local Repository</button>
            <button id="refresh-repos" class="button-secondary" type="button">Refresh Repository List</button>
          </div>
        </form>
        <form id="github-analysis-form">
          <div>
            <label for="repositoryUrl">GitHub or GitLab repository (HTTPS)</label>
            <input id="repositoryUrl" name="repositoryUrl" type="text" placeholder="https://github.com/scala/scala.git or https://gitlab.com/group/project.git" autocomplete="off" />
          </div>
          <div>
            <label for="gitRef">Branch or tag (optional)</label>
            <input id="gitRef" name="gitRef" type="text" placeholder="main" autocomplete="off" />
          </div>
          <div class="button-row">
            <button type="submit">Clone &amp; analyze (GitHub / GitLab)</button>
          </div>
        </form>
        <div class="meta">
          <div>
            <strong>Public runtime URL</strong>
            <div>${runtimeUrl}</div>
          </div>
          <div>
            <strong>Editor URL</strong>
            <div>${editorUrl}</div>
          </div>
        </div>
        <div>
          <strong>Allowed repository roots</strong>
          ${allowedRoots}
        </div>
        <div id="result" class="result">
          <p id="result-summary"></p>
          <div class="links">
            <a id="sbt-link" class="link" href="#" target="_blank" rel="noreferrer">Open sbt diagram</a>
            <a id="packages-link" class="link" href="#" target="_blank" rel="noreferrer">Open package diagram</a>
          </div>
          <pre id="result-json"></pre>
        </div>
        <p id="error" class="error"></p>
      </div>
      <div class="columns">
        <section class="card">
          <div class="section-title">
            <h2>Recent Repositories</h2>
            <span class="repo-meta">click to reopen</span>
          </div>
          <div id="recent-repos" class="repo-list"></div>
        </section>
        <section class="card">
          <div class="section-title">
            <h2>Discovered Repositories</h2>
            <span class="repo-meta">under allowed roots</span>
          </div>
          <div id="discovered-repos" class="repo-list"></div>
        </section>
      </div>
    </div>
  </main>
  <script id="runtime-home-bootstrap" type="application/json">${bootstrapJson}</script>
  <script>
    const bootstrap = JSON.parse(document.getElementById('runtime-home-bootstrap').textContent);
    const form = document.getElementById('analysis-form');
    const githubForm = document.getElementById('github-analysis-form');
    const workspacePathInput = document.getElementById('workspacePath');
    const repositoryUrlInput = document.getElementById('repositoryUrl');
    const gitRefInput = document.getElementById('gitRef');
    const refreshReposButton = document.getElementById('refresh-repos');
    const recentRepos = document.getElementById('recent-repos');
    const discoveredRepos = document.getElementById('discovered-repos');
    const result = document.getElementById('result');
    const resultSummary = document.getElementById('result-summary');
    const resultJson = document.getElementById('result-json');
    const error = document.getElementById('error');
    const sbtLink = document.getElementById('sbt-link');
    const packagesLink = document.getElementById('packages-link');
    function formatLastOpened(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    }
    function repoKind(repo) {
      return repo && repo.probe && repo.probe.kind ? repo.probe.kind : 'workspace';
    }
    function renderRepoItem(repo, includeLastOpened) {
      const lastOpened = includeLastOpened && repo.lastOpenedAt
        ? '<p class="repo-meta">Last opened: ' + formatLastOpened(repo.lastOpenedAt) + '</p>'
        : '';
      return '<article class="repo-item">' +
        '<header>' +
          '<div>' +
            '<h3>' + repo.workspaceName + '</h3>' +
            '<p class="repo-path"><code>' + repo.workspacePath + '</code></p>' +
            '<p class="repo-meta">Detected: <span class="badge">' + repoKind(repo) + '</span></p>' +
            lastOpened +
          '</div>' +
        '</header>' +
        '<div class="repo-actions">' +
          '<button type="button" data-open-repo="' + repo.workspacePath + '">Analyze</button>' +
          '<button type="button" class="button-secondary" data-fill-path="' + repo.workspacePath + '">Use Path</button>' +
        '</div>' +
      '</article>';
    }
    function renderRepoLists(model) {
      recentRepos.innerHTML = model.recentRepos && model.recentRepos.length
        ? model.recentRepos.map((repo) => renderRepoItem(repo, true)).join('')
        : '<p class="empty">No repositories opened yet.</p>';
      discoveredRepos.innerHTML = model.discoveredRepos && model.discoveredRepos.length
        ? model.discoveredRepos.map((repo) => renderRepoItem(repo, false)).join('')
        : '<p class="empty">No repositories discovered under the configured roots.</p>';
    }
    async function refreshRepoLists() {
      const response = await fetch('/api/home');
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error || ('Failed to refresh repositories (' + response.status + ').'));
      }
      renderRepoLists(body);
      return body;
    }
    async function submitWorkspacePath(workspacePath) {
      error.textContent = '';
      result.classList.remove('visible');
      if (!workspacePath) {
        error.textContent = 'Please enter an absolute repository path.';
        return;
      }
      try {
        const response = await fetch('/api/analysis/local', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspacePath }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.ok) {
          error.textContent = body.error || ('Request failed (' + response.status + ').');
          resultJson.textContent = JSON.stringify(body, null, 2);
          result.classList.add('visible');
          return;
        }
        resultSummary.textContent = 'Ready: ' + body.workspaceName + ' (' + body.probe.kind + ')';
        resultJson.textContent = JSON.stringify(body, null, 2);
        if (body.launch && body.launch.sbtDiagramUrl) {
          sbtLink.href = body.launch.sbtDiagramUrl;
          sbtLink.style.display = '';
        } else {
          sbtLink.style.display = 'none';
        }
        if (body.launch && body.launch.packagesDiagramUrl) {
          packagesLink.href = body.launch.packagesDiagramUrl;
          packagesLink.style.display = '';
        } else {
          packagesLink.style.display = 'none';
        }
        result.classList.add('visible');
        refreshRepoLists().catch(() => {});
      } catch (err) {
        error.textContent = err && err.message ? err.message : String(err);
      }
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitWorkspacePath(workspacePathInput.value.trim());
    });
    githubForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      result.classList.remove('visible');
      const repositoryUrl = repositoryUrlInput.value.trim();
      const ref = gitRefInput.value.trim();
      if (!repositoryUrl) {
        error.textContent = 'Please enter a GitHub or GitLab HTTPS repository URL.';
        return;
      }
      try {
        const response = await fetch('/api/analysis/github', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repositoryUrl, ref }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.ok) {
          error.textContent = body.error || ('Request failed (' + response.status + ').');
          resultJson.textContent = JSON.stringify(body, null, 2);
          result.classList.add('visible');
          return;
        }
        resultSummary.textContent = 'Ready (clone): ' + body.workspaceName + ' (' + body.probe.kind + ')';
        resultJson.textContent = JSON.stringify(body, null, 2);
        if (body.launch && body.launch.sbtDiagramUrl) {
          sbtLink.href = body.launch.sbtDiagramUrl;
          sbtLink.style.display = '';
        } else {
          sbtLink.style.display = 'none';
        }
        if (body.launch && body.launch.packagesDiagramUrl) {
          packagesLink.href = body.launch.packagesDiagramUrl;
          packagesLink.style.display = '';
        } else {
          packagesLink.style.display = 'none';
        }
        result.classList.add('visible');
        workspacePathInput.value = body.workspacePath || '';
        refreshRepoLists().catch(() => {});
      } catch (err) {
        error.textContent = err && err.message ? err.message : String(err);
      }
    });
    refreshReposButton.addEventListener('click', () => {
      refreshRepoLists().catch((err) => {
        error.textContent = err && err.message ? err.message : String(err);
      });
    });
    document.addEventListener('click', (event) => {
      const fillPath = event.target && event.target.getAttribute ? event.target.getAttribute('data-fill-path') : '';
      if (fillPath) {
        workspacePathInput.value = fillPath;
        workspacePathInput.focus();
        return;
      }
      const openRepo = event.target && event.target.getAttribute ? event.target.getAttribute('data-open-repo') : '';
      if (openRepo) {
        workspacePathInput.value = openRepo;
        submitWorkspacePath(openRepo);
      }
    });
    renderRepoLists(bootstrap);
  </script>
</body>
</html>`
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

function normalizeRoutePathname(pathname) {
  const p = String(pathname || '/').replace(/\/{2,}/g, '/')
  if (p.length > 1 && p.endsWith('/')) return p.replace(/\/+$/, '')
  return p
}

/** When a reverse proxy forwards /prefix/api/... set TRITON_HTTP_PATH_PREFIX=/prefix */
function stripConfiguredPathPrefix(pathname, prefixRaw) {
  const prefRaw = String(prefixRaw || '').trim()
  if (!prefRaw) return pathname
  const prefix = normalizeRoutePathname(prefRaw.startsWith('/') ? prefRaw : `/${prefRaw}`)
  if (!prefix || prefix === '/') return pathname
  const n = pathname
  if (n === prefix) return '/'
  if (n.startsWith(`${prefix}/`)) {
    return normalizeRoutePathname(n.slice(prefix.length) || '/')
  }
  return n
}

function routePathname(urlPathname, prefixRaw) {
  return stripConfiguredPathPrefix(normalizeRoutePathname(urlPathname), prefixRaw)
}

function createRuntimeServer(options = {}) {
  const persistence = options.persistence
  if (!persistence || typeof persistence.listRecentRepositories !== 'function') {
    throw new Error('createRuntimeServer requires options.persistence from createPersistence()')
  }
  const config = { ...runtimeConfig(options), persistence }
  return http.createServer(async (req, res) => {
    const method = req.method || 'GET'
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const pathnameRaw = normalizeRoutePathname(url.pathname)
    const pathname = routePathname(url.pathname, config.httpPathPrefix)

    if (method === 'OPTIONS') {
      applyCorsHeaders(res)
      res.writeHead(204)
      res.end()
      return
    }

    if (method === 'GET' && pathname === '/') {
      const html = await runtimeHomeHtml(config)
      applyCorsHeaders(res)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
        'cache-control': 'no-store',
      })
      res.end(html)
      return
    }

    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'triton-runtime',
        version: RUNTIME_VERSION,
        capabilities: runtimeCapabilities(config),
        allowedRepoRoots: config.allowedRepoRoots,
        gitCacheRoot: config.gitCacheRoot,
        httpPathPrefix: config.httpPathPrefix || undefined,
        persistence: config.persistence.kind,
        editorUrl: config.editorUrl,
        publicRuntimeUrl: config.publicRuntimeUrl,
      })
      return
    }

    if (method === 'GET' && pathname === '/api/courses') {
      if (typeof config.persistence.listCourses !== 'function') {
        sendJson(res, 501, { ok: false, error: 'courses_not_supported' })
        return
      }
      const courses = await config.persistence.listCourses()
      sendJson(res, 200, { ok: true, courses })
      return
    }

    if (method === 'POST' && pathname === '/api/courses') {
      if (typeof config.persistence.createCourse !== 'function') {
        sendJson(res, 501, { ok: false, error: 'courses_not_supported' })
        return
      }
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const result = await config.persistence.createCourse({
        slug: body.slug,
        title: body.title,
        term: body.term,
      })
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error })
        return
      }
      sendJson(res, 200, { ok: true, course: result.course })
      return
    }

    if (method === 'DELETE' && pathname.startsWith('/api/courses/')) {
      if (typeof config.persistence.deleteCourse !== 'function') {
        sendJson(res, 501, { ok: false, error: 'courses_not_supported' })
        return
      }
      const id = pathname.slice('/api/courses/'.length).trim()
      if (!id || id.includes('/')) {
        sendJson(res, 400, { ok: false, error: 'invalid_course_id' })
        return
      }
      const result = await config.persistence.deleteCourse(id)
      if (!result.ok) {
        const code = result.error === 'course_not_found' ? 404 : 400
        sendJson(res, code, { ok: false, error: result.error })
        return
      }
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && pathname === '/api/home') {
      sendJson(res, 200, await apiHomeModel(config))
      return
    }

    if (method === 'GET' && pathname === '/api/analysis/github') {
      sendJson(res, 200, {
        ok: true,
        message:
          'Routes: POST /api/analysis/github (register) and POST /api/workspace/github/sync (pull latest). GitHub push webhooks: POST /api/webhooks/github (GitHub → runtime). Register: POST /api/webhooks/github/register with JSON { repositoryUrl, workspacePath?, branch?, workspaceName? } — omit workspacePath after cloning via analyze/sync so the runtime uses the git-cache path; optional TRITON_WEBHOOK_ADMIN_TOKEN (Bearer) required when set. Body for analyze/sync: { "repositoryUrl": "https URL", "ref": "optional" }. Hosts: github.com, gitlab.com, or TRITON_EXTRA_GIT_HOSTS. Tokens: Authorization Bearer, x-github-token / x-gitlab-token, JSON git token fields, or TRITON_GITHUB_TOKEN / TRITON_GITLAB_TOKEN.',
        methodHint: 'POST',
        path: '/api/analysis/github',
        runtimeVersion: RUNTIME_VERSION,
        pathnameRaw,
        httpPathPrefix: config.httpPathPrefix || '',
      })
      return
    }

    if (method === 'POST' && pathname === '/api/analysis/local') {
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const result = await analyzeLocalWorkspace(body, config)
      sendJson(res, result.statusCode, result.body)
      return
    }

    if (method === 'POST' && pathname === '/api/analysis/github') {
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const token = remoteGitTokenFromRequest(body, req)
      const result = await registerGithubWorkspace(body, config, token, 'github')
      sendJson(res, result.statusCode, result.body)
      return
    }

    if (method === 'POST' && pathname === '/api/workspace/github/sync') {
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const token = remoteGitTokenFromRequest(body, req)
      const result = await registerGithubWorkspace(body, config, token, 'github-sync')
      sendJson(res, result.statusCode, result.body)
      return
    }

    if (method === 'GET' && pathname === '/api/workspace/bundle') {
      const workspacePath = String(url.searchParams.get('workspacePath') || '').trim()
      const validation = validateWorkspacePath(workspacePath, config)
      if (!validation.ok) {
        sendJson(res, validation.statusCode, {
          ok: false,
          error: validation.error,
          workspacePath: validation.workspacePath,
          allowedRepoRoots: validation.allowedRepoRoots,
        })
        return
      }
      sendJson(res, 200, readWorkspaceBundle(validation.workspacePath))
      return
    }

    if (method === 'GET' && pathname === '/api/workspace/source') {
      const workspacePath = String(url.searchParams.get('workspacePath') || '').trim()
      const relPath = String(url.searchParams.get('relPath') || '').trim()
      const validation = validateWorkspacePath(workspacePath, config)
      if (!validation.ok) {
        sendJson(res, validation.statusCode, {
          ok: false,
          error: validation.error,
          workspacePath: validation.workspacePath,
          allowedRepoRoots: validation.allowedRepoRoots,
        })
        return
      }
      const fileValidation = validateWorkspaceRelativeFile(validation.workspacePath, relPath)
      if (!fileValidation.ok) {
        sendJson(res, fileValidation.statusCode, {
          ok: false,
          error: fileValidation.error,
          workspacePath: validation.workspacePath,
          relPath: fileValidation.relPath,
        })
        return
      }
      const source = readUtf8IfFile(fileValidation.absPath)
      if (source == null) {
        sendJson(res, 500, {
          ok: false,
          error: 'source_path_unreadable',
          workspacePath: validation.workspacePath,
          relPath: fileValidation.relPath,
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        workspacePath: validation.workspacePath,
        relPath: fileValidation.relPath,
        source,
      })
      return
    }

    if (method === 'POST' && pathname === '/api/workspace/action') {
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

    if (method === 'GET' && pathname === '/api/webhooks/github/repos') {
      if (!webhookAdminAuthorized(req)) {
        sendJson(res, 403, { ok: false, error: 'webhook_admin_unauthorized' })
        return
      }
      if (typeof config.persistence.listRepoWebhooks !== 'function') {
        sendJson(res, 501, { ok: false, error: 'webhooks_not_supported' })
        return
      }
      const rows = await config.persistence.listRepoWebhooks()
      sendJson(res, 200, { ok: true, repos: rows })
      return
    }

    if (method === 'POST' && pathname === '/api/webhooks/github/register') {
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const result = await apiRegisterGithubWebhook(body, config, req)
      sendJson(res, result.statusCode, result.body)
      return
    }

    if (method === 'POST' && pathname === '/api/webhooks/github/delete') {
      const raw = await collectBody(req)
      const body = safeJsonParse(raw)
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'invalid_json' })
        return
      }
      const result = await apiDeleteGithubWebhook(body, config, req)
      sendJson(res, result.statusCode, result.body)
      return
    }

    if (method === 'POST' && pathname === '/api/webhooks/github') {
      const rawBuf = await collectBodyRaw(req)
      const result = await apiGithubWebhookIngress(rawBuf, req, config)
      sendJson(res, result.statusCode, result.body)
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: 'not_found',
      method,
      path: pathname,
      pathnameRaw,
      rawUrl: req.url,
      httpPathPrefix: config.httpPathPrefix || '',
      hint:
        'Open GET /api/analysis/github in a browser; if that 404s too, check TRITON_HTTP_PATH_PREFIX matches your reverse-proxy path prefix.',
    })
  })
}

async function startRuntimeServer(options = {}) {
  const host = String(options.host || '127.0.0.1')
  const port = Number(options.port || 4317)
  const baseConfig = runtimeConfig({ ...options, host, port })
  const persistence = await createPersistence(baseConfig)
  const server = createRuntimeServer({ ...options, host, port, persistence })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const cfg = runtimeConfig({ ...options, host, port })
      process.stderr.write(
        `[triton-runtime] listening http://${host}:${port} version=${RUNTIME_VERSION} persistence=${persistence.kind} TRITON_HTTP_PATH_PREFIX=${cfg.httpPathPrefix || '(unset)'}\n`,
      )
      if (
        typeof persistence.registerRepoWebhook === 'function' &&
        !String(process.env.TRITON_WEBHOOK_ADMIN_TOKEN || '').trim()
      ) {
        process.stderr.write(
          '[triton-runtime] webhooks: TRITON_WEBHOOK_ADMIN_TOKEN is unset — webhook admin routes are open; set the token in production.\n',
        )
      }
      resolve({
        server,
        host,
        port,
        url: `http://${host}:${port}`,
        persistence,
      })
    })
  })
}

module.exports = {
  createPersistence,
  createRuntimeServer,
  probeWorkspace,
  readWorkspaceBundle,
  startRuntimeServer,
}

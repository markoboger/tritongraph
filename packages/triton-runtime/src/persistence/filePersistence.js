const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const RECENT_LIMIT = 12

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function readJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallbackValue
  }
}

function writeJsonFile(filePath, value) {
  ensureDirSync(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function recentReposFilePath(config) {
  return path.join(config.stateDir, 'recent-repos.json')
}

function directoryFilePath(config) {
  return path.join(config.stateDir, 'directory.json')
}

function repoWebhooksFilePath(config) {
  return path.join(config.stateDir, 'repo-webhooks.json')
}

function readDirectoryState(config) {
  const raw = readJsonFile(directoryFilePath(config), { courses: [], courseWorkspaces: [] })
  return {
    courses: Array.isArray(raw.courses) ? raw.courses : [],
    courseWorkspaces: Array.isArray(raw.courseWorkspaces) ? raw.courseWorkspaces : [],
  }
}

function writeDirectoryState(config, state) {
  writeJsonFile(directoryFilePath(config), {
    courses: state.courses,
    courseWorkspaces: state.courseWorkspaces,
  })
}

function readRepoWebhookState(config) {
  const raw = readJsonFile(repoWebhooksFilePath(config), { repos: [], deliveries: [] })
  return {
    repos: Array.isArray(raw.repos) ? raw.repos : [],
    deliveries: Array.isArray(raw.deliveries) ? raw.deliveries : [],
  }
}

function writeRepoWebhookState(config, state) {
  const deliveries = Array.isArray(state.deliveries) ? state.deliveries.slice(-400) : []
  writeJsonFile(repoWebhooksFilePath(config), { repos: state.repos, deliveries })
}

function normalizeSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function isRemoteGitSource(value) {
  return value === 'github' || value === 'gitlab'
}

function normalizeStoredRow(entry) {
  const workspacePath = String(entry && entry.workspacePath ? entry.workspacePath : '').trim()
  if (!workspacePath) return null
  const workspaceName = String(entry.workspaceName || '').trim()
  const lastOpenedAt = String(entry.lastOpenedAt || '').trim()
  const row = { workspacePath, workspaceName, lastOpenedAt }
  if (isRemoteGitSource(entry.source)) {
    row.source = entry.source
    const ru = String(entry.repositoryUrl || '').trim()
    if (ru) row.repositoryUrl = ru
    const gr = String(entry.gitRef || '').trim()
    if (gr) row.gitRef = gr
  }
  return row
}

function createFilePersistence(config) {
  const fp = () => recentReposFilePath(config)

  return {
    kind: 'file',
    async init() {},
    async close() {},

    async listRecentRepositories() {
      const raw = readJsonFile(fp(), [])
      if (!Array.isArray(raw)) return []
      return raw.map(normalizeStoredRow).filter(Boolean).slice(0, RECENT_LIMIT)
    },

    async recordRecentRepository(row) {
      const workspacePath = String(row.workspacePath || '').trim()
      if (!workspacePath) return
      const workspaceName = String(row.workspaceName || '').trim()
      const stored = {
        workspacePath,
        workspaceName,
        lastOpenedAt: String(row.lastOpenedAt || new Date().toISOString()),
      }
      if (isRemoteGitSource(row.source)) {
        stored.source = row.source
        if (row.repositoryUrl) stored.repositoryUrl = String(row.repositoryUrl).trim()
        if (row.gitRef) stored.gitRef = String(row.gitRef).trim()
      }

      const raw = readJsonFile(fp(), [])
      const prev = Array.isArray(raw) ? raw : []
      const filtered = prev.filter((e) => String(e && e.workspacePath).trim() !== workspacePath)
      filtered.unshift(stored)
      writeJsonFile(fp(), filtered.slice(0, RECENT_LIMIT))
    },

    async removeRecentRepository(workspacePath) {
      const wp = String(workspacePath || '').trim()
      if (!wp) return { ok: false, error: 'missing_workspace_path' }
      const raw = readJsonFile(fp(), [])
      if (!Array.isArray(raw)) return { ok: true }
      const next = raw.filter((e) => String(e && e.workspacePath).trim() !== wp)
      writeJsonFile(fp(), next)
      return { ok: true }
    },

    async detachWorkspaceFromCourse(row) {
      const courseId = String(row.courseId || '').trim()
      const workspacePath = String(row.workspacePath || '').trim()
      if (!courseId || !workspacePath) return { ok: false, error: 'course_and_path_required' }
      const state = readDirectoryState(config)
      const nextLinks = state.courseWorkspaces.filter(
        (l) => !(String(l.courseId) === courseId && String(l.workspacePath).trim() === workspacePath),
      )
      if (nextLinks.length === state.courseWorkspaces.length) {
        return { ok: false, error: 'course_workspace_not_found' }
      }
      writeDirectoryState(config, { courses: state.courses, courseWorkspaces: nextLinks })
      return { ok: true }
    },

    async listCourses() {
      const { courses } = readDirectoryState(config)
      return [...courses].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    },

    async getCourse(courseId) {
      const id = String(courseId || '').trim()
      if (!id) return null
      const { courses } = readDirectoryState(config)
      return courses.find((c) => String(c.id) === id) || null
    },

    async createCourse({ slug, title, term }) {
      const s = normalizeSlug(slug)
      const t = String(title || '').trim()
      if (!s) return { ok: false, error: 'course_slug_required' }
      if (!t) return { ok: false, error: 'course_title_required' }
      const state = readDirectoryState(config)
      if (state.courses.some((c) => String(c.slug) === s)) {
        return { ok: false, error: 'course_slug_exists' }
      }
      const id = crypto.randomUUID()
      const rec = {
        id,
        slug: s,
        title: t,
        term: String(term || '').trim(),
        createdAt: new Date().toISOString(),
      }
      state.courses.push(rec)
      writeDirectoryState(config, state)
      return { ok: true, course: rec }
    },

    async deleteCourse(courseId) {
      const id = String(courseId || '').trim()
      if (!id) return { ok: false, error: 'course_id_required' }
      const state = readDirectoryState(config)
      const nextCourses = state.courses.filter((c) => String(c.id) !== id)
      if (nextCourses.length === state.courses.length) return { ok: false, error: 'course_not_found' }
      const nextLinks = state.courseWorkspaces.filter((l) => String(l.courseId) !== id)
      writeDirectoryState(config, { courses: nextCourses, courseWorkspaces: nextLinks })
      return { ok: true }
    },

    async listWorkspacesForCourse(courseId) {
      const id = String(courseId || '').trim()
      if (!id) return []
      const { courseWorkspaces } = readDirectoryState(config)
      return courseWorkspaces
        .filter((l) => String(l.courseId) === id)
        .map((l) => ({
          courseId: l.courseId,
          workspacePath: String(l.workspacePath || '').trim(),
          workspaceName: String(l.workspaceName || '').trim(),
          repositoryUrl: l.repositoryUrl ? String(l.repositoryUrl) : undefined,
          gitRef: l.gitRef ? String(l.gitRef) : undefined,
          source: isRemoteGitSource(l.source) ? l.source : undefined,
          linkedAt: String(l.linkedAt || ''),
        }))
        .filter((l) => l.workspacePath)
    },

    async attachWorkspaceToCourse(row) {
      const courseId = String(row.courseId || '').trim()
      const workspacePath = String(row.workspacePath || '').trim()
      const workspaceName = String(row.workspaceName || '').trim()
      if (!courseId || !workspacePath) return { ok: false, error: 'course_and_path_required' }
      const course = await this.getCourse(courseId)
      if (!course) return { ok: false, error: 'course_not_found' }
      const state = readDirectoryState(config)
      const link = {
        courseId,
        workspacePath,
        workspaceName: workspaceName || workspacePath,
        repositoryUrl: row.repositoryUrl ? String(row.repositoryUrl).trim() : '',
        gitRef: row.gitRef ? String(row.gitRef).trim() : '',
        source: isRemoteGitSource(row.source) ? row.source : '',
        linkedAt: new Date().toISOString(),
      }
      const rest = state.courseWorkspaces.filter(
        (l) => !(String(l.courseId) === courseId && String(l.workspacePath).trim() === workspacePath),
      )
      rest.push(link)
      writeDirectoryState(config, { courses: state.courses, courseWorkspaces: rest })
      return { ok: true }
    },

    async registerRepoWebhook({ canonicalRepositoryUrl, workspacePath, workspaceName, branch, secret: secretIn, provider }) {
      const canonical = String(canonicalRepositoryUrl || '').trim()
      const wp = String(workspacePath || '').trim()
      const wn = String(workspaceName || '').trim()
      const br = String(branch || 'main').trim() || 'main'
      const prov = String(provider || 'github').trim() || 'github'
      if (!canonical) return { ok: false, error: 'repository_url_required' }
      if (!wp) return { ok: false, error: 'workspace_path_required' }
      const secret =
        secretIn && String(secretIn).trim() ? String(secretIn).trim() : crypto.randomBytes(32).toString('hex')
      const state = readRepoWebhookState(config)
      const rest = state.repos.filter((r) => String(r.canonicalRepositoryUrl || '').trim() !== canonical)
      const createdAt = new Date().toISOString()
      rest.push({
        canonicalRepositoryUrl: canonical,
        workspacePath: wp,
        workspaceName: wn || wp,
        branch: br,
        secret,
        provider: prov,
        createdAt,
      })
      rest.sort((a, b) => String(a.canonicalRepositoryUrl).localeCompare(String(b.canonicalRepositoryUrl)))
      writeRepoWebhookState(config, { repos: rest, deliveries: state.deliveries })
      const pub = {
        canonicalRepositoryUrl: canonical,
        workspacePath: wp,
        workspaceName: wn || wp,
        branch: br,
        provider: prov,
        createdAt,
      }
      return { ok: true, secret, webhook: pub }
    },

    async getRepoWebhook(canonicalRepositoryUrl) {
      const canonical = String(canonicalRepositoryUrl || '').trim()
      if (!canonical) return null
      const { repos } = readRepoWebhookState(config)
      const row = repos.find((r) => String(r.canonicalRepositoryUrl || '').trim() === canonical)
      if (!row) return null
      return {
        canonicalRepositoryUrl: row.canonicalRepositoryUrl,
        workspacePath: row.workspacePath,
        workspaceName: row.workspaceName,
        branch: row.branch || 'main',
        secret: row.secret,
        provider: row.provider || 'github',
        createdAt: row.createdAt || '',
      }
    },

    async listRepoWebhooks() {
      const { repos } = readRepoWebhookState(config)
      return repos.map((row) => ({
        canonicalRepositoryUrl: row.canonicalRepositoryUrl,
        workspacePath: row.workspacePath,
        workspaceName: row.workspaceName,
        branch: row.branch || 'main',
        provider: row.provider || 'github',
        createdAt: row.createdAt || '',
      }))
    },

    async deleteRepoWebhook(canonicalRepositoryUrl) {
      const canonical = String(canonicalRepositoryUrl || '').trim()
      if (!canonical) return { ok: false, error: 'repository_url_required' }
      const state = readRepoWebhookState(config)
      const next = state.repos.filter((r) => String(r.canonicalRepositoryUrl || '').trim() !== canonical)
      if (next.length === state.repos.length) return { ok: false, error: 'webhook_not_found' }
      writeRepoWebhookState(config, { repos: next, deliveries: state.deliveries })
      return { ok: true }
    },

    async tryClaimWebhookDelivery(deliveryId, { provider, canonicalRepositoryUrl }) {
      const id = String(deliveryId || '').trim()
      if (!id) return false
      const state = readRepoWebhookState(config)
      if (state.deliveries.includes(id)) return false
      const deliveries = [...state.deliveries, id]
      writeRepoWebhookState(config, { repos: state.repos, deliveries })
      return true
    },

    async finishWebhookDelivery(_deliveryId, _status, _detail) {
      /* file backend: no durable delivery log beyond id dedupe */
    },
  }
}

module.exports = { createFilePersistence, RECENT_LIMIT, normalizeSlug }

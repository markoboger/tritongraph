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

function normalizeSlug(slug) {
  return String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeStoredRow(entry) {
  const workspacePath = String(entry && entry.workspacePath ? entry.workspacePath : '').trim()
  if (!workspacePath) return null
  const workspaceName = String(entry.workspaceName || '').trim()
  const lastOpenedAt = String(entry.lastOpenedAt || '').trim()
  const row = { workspacePath, workspaceName, lastOpenedAt }
  if (entry.source === 'github') {
    row.source = 'github'
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
      if (row.source === 'github') {
        stored.source = 'github'
        if (row.repositoryUrl) stored.repositoryUrl = String(row.repositoryUrl).trim()
        if (row.gitRef) stored.gitRef = String(row.gitRef).trim()
      }

      const raw = readJsonFile(fp(), [])
      const prev = Array.isArray(raw) ? raw : []
      const filtered = prev.filter((e) => String(e && e.workspacePath).trim() !== workspacePath)
      filtered.unshift(stored)
      writeJsonFile(fp(), filtered.slice(0, RECENT_LIMIT))
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
          source: l.source === 'github' ? 'github' : undefined,
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
        source: row.source === 'github' ? 'github' : '',
        linkedAt: new Date().toISOString(),
      }
      const rest = state.courseWorkspaces.filter(
        (l) => !(String(l.courseId) === courseId && String(l.workspacePath).trim() === workspacePath),
      )
      rest.push(link)
      writeDirectoryState(config, { courses: state.courses, courseWorkspaces: rest })
      return { ok: true }
    },
  }
}

module.exports = { createFilePersistence, RECENT_LIMIT, normalizeSlug }

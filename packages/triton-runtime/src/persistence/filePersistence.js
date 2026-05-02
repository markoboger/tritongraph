const fs = require('fs')
const path = require('path')

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
  }
}

module.exports = { createFilePersistence, RECENT_LIMIT }

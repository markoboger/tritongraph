const { RECENT_LIMIT } = require('./filePersistence')

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS triton_recent_repos (
  workspace_path TEXT PRIMARY KEY,
  workspace_name TEXT NOT NULL,
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  repository_url TEXT,
  git_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_triton_recent_repos_last ON triton_recent_repos (last_opened_at DESC);
`

function rowFromPg(r) {
  const out = {
    workspacePath: r.workspace_path,
    workspaceName: r.workspace_name,
    lastOpenedAt: r.last_opened_at ? new Date(r.last_opened_at).toISOString() : '',
  }
  if (r.source === 'github') {
    out.source = 'github'
    if (r.repository_url) out.repositoryUrl = r.repository_url
    if (r.git_ref) out.gitRef = r.git_ref
  }
  return out
}

function createPostgresPersistence(config) {
  let pool

  return {
    kind: 'postgres',

    async init() {
      let Pool
      try {
        Pool = require('pg').Pool
      } catch {
        throw new Error(
          'Postgres persistence requires the `pg` package. Run `npm install` in packages/triton-runtime.',
        )
      }
      pool = new Pool({
        connectionString: config.databaseUrl,
        max: 8,
      })
      await pool.query(MIGRATION_SQL)
    },

    async close() {
      if (pool) await pool.end()
      pool = null
    },

    async listRecentRepositories() {
      const r = await pool.query(
        `SELECT workspace_path, workspace_name, last_opened_at, source, repository_url, git_ref
         FROM triton_recent_repos
         ORDER BY last_opened_at DESC
         LIMIT $1`,
        [RECENT_LIMIT],
      )
      return r.rows.map(rowFromPg)
    },

    async recordRecentRepository(row) {
      const workspacePath = String(row.workspacePath || '').trim()
      if (!workspacePath) return
      const workspaceName = String(row.workspaceName || '').trim()
      const lastOpenedAt = row.lastOpenedAt ? new Date(row.lastOpenedAt) : new Date()
      const source = row.source === 'github' ? 'github' : null
      const repositoryUrl = row.repositoryUrl ? String(row.repositoryUrl).trim() : null
      const gitRef = row.gitRef ? String(row.gitRef).trim() : null

      await pool.query(
        `INSERT INTO triton_recent_repos (workspace_path, workspace_name, last_opened_at, source, repository_url, git_ref)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_path) DO UPDATE SET
           workspace_name = EXCLUDED.workspace_name,
           last_opened_at = EXCLUDED.last_opened_at,
           source = EXCLUDED.source,
           repository_url = EXCLUDED.repository_url,
           git_ref = EXCLUDED.git_ref`,
        [workspacePath, workspaceName, lastOpenedAt, source, repositoryUrl, gitRef],
      )

      await pool.query(
        `WITH keepers AS (
           SELECT workspace_path FROM triton_recent_repos ORDER BY last_opened_at DESC LIMIT $1
         )
         DELETE FROM triton_recent_repos r
         WHERE NOT EXISTS (SELECT 1 FROM keepers k WHERE k.workspace_path = r.workspace_path)`,
        [RECENT_LIMIT],
      )
    },
  }
}

module.exports = { createPostgresPersistence }

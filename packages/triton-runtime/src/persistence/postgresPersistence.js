const { RECENT_LIMIT, normalizeSlug } = require('./filePersistence')

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

CREATE TABLE IF NOT EXISTS triton_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  term TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS triton_course_workspaces (
  course_id UUID NOT NULL REFERENCES triton_courses(id) ON DELETE CASCADE,
  workspace_path TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  repository_url TEXT,
  git_ref TEXT,
  source TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, workspace_path)
);

CREATE TABLE IF NOT EXISTS triton_repo_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_repository_url TEXT NOT NULL UNIQUE,
  workspace_path TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  secret TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'github',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS triton_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  canonical_repository_url TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

function isRemoteGitSource(value) {
  return value === 'github' || value === 'gitlab'
}

function rowFromPg(r) {
  const out = {
    workspacePath: r.workspace_path,
    workspaceName: r.workspace_name,
    lastOpenedAt: r.last_opened_at ? new Date(r.last_opened_at).toISOString() : '',
  }
  if (isRemoteGitSource(r.source)) {
    out.source = r.source
    if (r.repository_url) out.repositoryUrl = r.repository_url
    if (r.git_ref) out.gitRef = r.git_ref
  }
  return out
}

function courseFromPg(r) {
  return {
    id: String(r.id),
    slug: r.slug,
    title: r.title,
    term: r.term || '',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  }
}

function repoWebhookFromPg(r) {
  return {
    canonicalRepositoryUrl: r.canonical_repository_url,
    workspacePath: r.workspace_path,
    workspaceName: r.workspace_name,
    branch: r.branch || 'main',
    secret: r.secret,
    provider: r.provider || 'github',
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  }
}

function repoWebhookPublicFromPg(r) {
  const row = repoWebhookFromPg(r)
  delete row.secret
  return row
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
      const source = isRemoteGitSource(row.source) ? row.source : null
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

    async removeRecentRepository(workspacePath) {
      const wp = String(workspacePath || '').trim()
      if (!wp) return { ok: false, error: 'missing_workspace_path' }
      await pool.query(`DELETE FROM triton_recent_repos WHERE workspace_path = $1`, [wp])
      return { ok: true }
    },

    async listCourses() {
      const r = await pool.query(
        `SELECT id, slug, title, term, created_at FROM triton_courses ORDER BY title ASC`,
      )
      return r.rows.map(courseFromPg)
    },

    async getCourse(courseId) {
      const id = String(courseId || '').trim()
      if (!id) return null
      const r = await pool.query(`SELECT id, slug, title, term, created_at FROM triton_courses WHERE id = $1`, [id])
      return r.rows[0] ? courseFromPg(r.rows[0]) : null
    },

    async createCourse({ slug, title, term }) {
      const s = normalizeSlug(slug)
      const t = String(title || '').trim()
      if (!s) return { ok: false, error: 'course_slug_required' }
      if (!t) return { ok: false, error: 'course_title_required' }
      const tr = String(term || '').trim() || null
      try {
        const r = await pool.query(
          `INSERT INTO triton_courses (slug, title, term) VALUES ($1, $2, $3)
           RETURNING id, slug, title, term, created_at`,
          [s, t, tr],
        )
        return { ok: true, course: courseFromPg(r.rows[0]) }
      } catch (e) {
        if (e && e.code === '23505') return { ok: false, error: 'course_slug_exists' }
        throw e
      }
    },

    async deleteCourse(courseId) {
      const id = String(courseId || '').trim()
      if (!id) return { ok: false, error: 'course_id_required' }
      const r = await pool.query(`DELETE FROM triton_courses WHERE id = $1`, [id])
      if (r.rowCount === 0) return { ok: false, error: 'course_not_found' }
      return { ok: true }
    },

    async listWorkspacesForCourse(courseId) {
      const id = String(courseId || '').trim()
      if (!id) return []
      const r = await pool.query(
        `SELECT course_id, workspace_path, workspace_name, repository_url, git_ref, source, linked_at
         FROM triton_course_workspaces WHERE course_id = $1 ORDER BY linked_at DESC`,
        [id],
      )
      return r.rows.map((l) => ({
        courseId: String(l.course_id),
        workspacePath: l.workspace_path,
        workspaceName: l.workspace_name,
        repositoryUrl: l.repository_url || undefined,
        gitRef: l.git_ref || undefined,
        source: isRemoteGitSource(l.source) ? l.source : undefined,
        linkedAt: l.linked_at ? new Date(l.linked_at).toISOString() : '',
      }))
    },

    async attachWorkspaceToCourse(row) {
      const courseId = String(row.courseId || '').trim()
      const workspacePath = String(row.workspacePath || '').trim()
      const workspaceName = String(row.workspaceName || '').trim()
      if (!courseId || !workspacePath) return { ok: false, error: 'course_and_path_required' }
      const c = await this.getCourse(courseId)
      if (!c) return { ok: false, error: 'course_not_found' }
      const wn = workspaceName || workspacePath
      const repositoryUrl = row.repositoryUrl ? String(row.repositoryUrl).trim() : null
      const gitRef = row.gitRef ? String(row.gitRef).trim() : null
      const source = isRemoteGitSource(row.source) ? row.source : null
      await pool.query(
        `INSERT INTO triton_course_workspaces (course_id, workspace_path, workspace_name, repository_url, git_ref, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (course_id, workspace_path) DO UPDATE SET
           workspace_name = EXCLUDED.workspace_name,
           repository_url = EXCLUDED.repository_url,
           git_ref = EXCLUDED.git_ref,
           source = EXCLUDED.source,
           linked_at = NOW()`,
        [courseId, workspacePath, wn, repositoryUrl, gitRef, source],
      )
      return { ok: true }
    },

    async detachWorkspaceFromCourse(row) {
      const courseId = String(row.courseId || '').trim()
      const workspacePath = String(row.workspacePath || '').trim()
      if (!courseId || !workspacePath) return { ok: false, error: 'course_and_path_required' }
      const r = await pool.query(
        `DELETE FROM triton_course_workspaces WHERE course_id = $1 AND workspace_path = $2`,
        [courseId, workspacePath],
      )
      if (r.rowCount === 0) return { ok: false, error: 'course_workspace_not_found' }
      return { ok: true }
    },

    async registerRepoWebhook({ canonicalRepositoryUrl, workspacePath, workspaceName, branch, secret: secretIn, provider }) {
      const crypto = require('crypto')
      const canonical = String(canonicalRepositoryUrl || '').trim()
      const wp = String(workspacePath || '').trim()
      const wn = String(workspaceName || '').trim()
      const br = String(branch || 'main').trim() || 'main'
      const prov = String(provider || 'github').trim() || 'github'
      if (!canonical) return { ok: false, error: 'repository_url_required' }
      if (!wp) return { ok: false, error: 'workspace_path_required' }
      const secret = secretIn && String(secretIn).trim() ? String(secretIn).trim() : crypto.randomBytes(32).toString('hex')
      const r = await pool.query(
        `INSERT INTO triton_repo_webhooks (canonical_repository_url, workspace_path, workspace_name, branch, secret, provider)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (canonical_repository_url) DO UPDATE SET
           workspace_path = EXCLUDED.workspace_path,
           workspace_name = EXCLUDED.workspace_name,
           branch = EXCLUDED.branch,
           secret = EXCLUDED.secret,
           provider = EXCLUDED.provider
         RETURNING id, canonical_repository_url, workspace_path, workspace_name, branch, secret, provider, created_at`,
        [canonical, wp, wn || wp, br, secret, prov],
      )
      const row = r.rows[0]
      return {
        ok: true,
        secret,
        webhook: repoWebhookPublicFromPg(row),
      }
    },

    async getRepoWebhook(canonicalRepositoryUrl) {
      const canonical = String(canonicalRepositoryUrl || '').trim()
      if (!canonical) return null
      const r = await pool.query(
        `SELECT canonical_repository_url, workspace_path, workspace_name, branch, secret, provider, created_at
         FROM triton_repo_webhooks WHERE canonical_repository_url = $1`,
        [canonical],
      )
      return r.rows[0] ? repoWebhookFromPg(r.rows[0]) : null
    },

    async listRepoWebhooks() {
      const r = await pool.query(
        `SELECT canonical_repository_url, workspace_path, workspace_name, branch, provider, created_at
         FROM triton_repo_webhooks ORDER BY canonical_repository_url ASC`,
      )
      return r.rows.map(repoWebhookPublicFromPg)
    },

    async deleteRepoWebhook(canonicalRepositoryUrl) {
      const canonical = String(canonicalRepositoryUrl || '').trim()
      if (!canonical) return { ok: false, error: 'repository_url_required' }
      const res = await pool.query(`DELETE FROM triton_repo_webhooks WHERE canonical_repository_url = $1`, [canonical])
      if (res.rowCount === 0) return { ok: false, error: 'webhook_not_found' }
      return { ok: true }
    },

    /** @returns {Promise<boolean>} true if this delivery id was newly claimed (not a replay). */
    async tryClaimWebhookDelivery(deliveryId, { provider, canonicalRepositoryUrl }) {
      const id = String(deliveryId || '').trim()
      if (!id) return false
      const r = await pool.query(
        `INSERT INTO triton_webhook_deliveries (delivery_id, provider, canonical_repository_url, status, detail)
         VALUES ($1, $2, $3, 'received', NULL)
         ON CONFLICT (delivery_id) DO NOTHING
         RETURNING delivery_id`,
        [
          id,
          String(provider || 'unknown').trim(),
          canonicalRepositoryUrl ? String(canonicalRepositoryUrl).trim() : null,
        ],
      )
      return r.rows.length > 0
    },

    async finishWebhookDelivery(deliveryId, status, detail) {
      const id = String(deliveryId || '').trim()
      if (!id) return
      await pool.query(
        `UPDATE triton_webhook_deliveries SET status = $2, detail = $3 WHERE delivery_id = $1`,
        [id, String(status || 'ok').trim(), detail ? String(detail).slice(0, 2000) : null],
      )
    },
  }
}

module.exports = { createPostgresPersistence }

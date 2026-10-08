const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const {
  parseGitNumstat,
  readWorkspaceBasePython,
  readWorkspaceBundleAtRef,
  readWorkspaceGitDiff,
  readWorkspaceGitRefs,
} = require('../src/server')

test('parseGitNumstat reads added/removed per file', () => {
  const out = '5\t0\tapp/a.py\n2\t3\tapp/b.py\n'
  assert.deepStrictEqual(parseGitNumstat(out), [
    { path: 'app/a.py', added: 5, removed: 0 },
    { path: 'app/b.py', added: 2, removed: 3 },
  ])
})

test('parseGitNumstat treats binary "-" counts as zero', () => {
  assert.deepStrictEqual(parseGitNumstat('-\t-\tlogo.png\n'), [{ path: 'logo.png', added: 0, removed: 0 }])
})

test('parseGitNumstat ignores blank lines', () => {
  assert.deepStrictEqual(parseGitNumstat('\n1\t1\tx.py\n\n'), [{ path: 'x.py', added: 1, removed: 1 }])
})

test('readWorkspaceBasePython restricts base files to discovered source roots', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'triton-base-py-'))
  try {
    const git = (...args) => cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    fs.mkdirSync(path.join(repo, 'pkg', 'src', 'app'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'pkg', 'pyproject.toml'), '[project]\nname = "pkg"\n')
    fs.writeFileSync(path.join(repo, 'pkg', 'src', 'app', 'models.py'), 'X = 1\n')
    // Stray beside src/: collectPythonFiles excludes it, so the base listing must too.
    fs.writeFileSync(path.join(repo, 'scripts', 'tool.py'), 'Y = 2\n')
    git('init', '-q')
    git('add', '-A')
    git('-c', 'user.email=t@e.st', '-c', 'user.name=t', 'commit', '-qm', 'base')

    const out = readWorkspaceBasePython(repo, { base: 'HEAD' })
    assert.strictEqual(out.ok, true)
    assert.deepStrictEqual(
      out.pyFiles.map((f) => f.relPath),
      ['pkg/src/app/models.py'],
    )
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

/**
 * main:    c0 ── c2            (c2 touches main_only.py)
 *            └── c1  feature  (c1 adds feature.py)
 */
function withBranchedRepo(fn) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'triton-range-'))
  try {
    const git = (...args) => cp.execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    const commit = (msg) => git('-c', 'user.email=t@e.st', '-c', 'user.name=t', 'commit', '-qam', msg)
    const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text)
    git('init', '-q', '-b', 'main')
    write('shared.py', 'A = 1\n')
    write('main_only.py', 'B = 1\n')
    git('add', '-A')
    commit('c0')
    git('checkout', '-qb', 'feature')
    write('feature.py', 'C = 1\n')
    git('add', '-A')
    commit('c1')
    git('checkout', '-q', 'main')
    write('main_only.py', 'B = 2\n')
    commit('c2')
    fn(repo)
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
}

const paths = (out) => out.files.map((f) => f.path).sort()

test('merge-base diff shows only what the head branch introduced', () => {
  withBranchedRepo((repo) => {
    const out = readWorkspaceGitDiff(repo, { base: 'main', head: 'feature' })
    assert.strictEqual(out.ok, true)
    assert.deepStrictEqual(paths(out), ['feature.py'])
  })
})

test('direct diff compares the two states as they are', () => {
  withBranchedRepo((repo) => {
    const out = readWorkspaceGitDiff(repo, { base: 'main', head: 'feature', mode: 'direct' })
    assert.deepStrictEqual(paths(out), ['feature.py', 'main_only.py'])
  })
})

test('empty head diffs against the working tree, uncommitted edits included', () => {
  withBranchedRepo((repo) => {
    fs.writeFileSync(path.join(repo, 'shared.py'), 'A = 2\n')
    assert.deepStrictEqual(paths(readWorkspaceGitDiff(repo, { base: 'HEAD' })), ['shared.py'])
  })
})

test('base python is read at the merge-base, not at the base tip', () => {
  withBranchedRepo((repo) => {
    const out = readWorkspaceBasePython(repo, { base: 'main', head: 'feature' })
    const mainOnly = out.pyFiles.find((f) => f.relPath === 'main_only.py')
    assert.strictEqual(mainOnly.source, 'B = 1\n')
  })
})

test('bundle at a ref takes python sources from git, not from disk', () => {
  withBranchedRepo((repo) => {
    const out = readWorkspaceBundleAtRef(repo, 'feature')
    assert.strictEqual(out.ok, true)
    assert.ok(out.pyFiles.some((f) => f.relPath === 'feature.py'))
  })
})

test('unknown and option-like refs are rejected', () => {
  withBranchedRepo((repo) => {
    assert.strictEqual(readWorkspaceGitDiff(repo, { base: 'nope' }).error, 'unknown_base_ref')
    assert.strictEqual(readWorkspaceGitDiff(repo, { base: 'main', head: '--output=/tmp/x' }).error, 'unknown_head_ref')
    assert.strictEqual(readWorkspaceGitDiff(repo, { base: 'main', mode: 'x' }).error, 'invalid_mode')
    assert.strictEqual(readWorkspaceBundleAtRef(repo, '-x').error, 'unknown_ref')
  })
})

test('git refs lists branches and the recent commits of a ref', () => {
  withBranchedRepo((repo) => {
    const out = readWorkspaceGitRefs(repo, 'feature')
    assert.deepStrictEqual([...out.refs].sort(), ['feature', 'main'])
    assert.deepStrictEqual(out.commits.map((c) => c.subject), ['c1', 'c0'])
  })
})

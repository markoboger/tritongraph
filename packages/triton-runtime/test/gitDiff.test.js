const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const { parseGitNumstat, readWorkspaceBasePython } = require('../src/server')

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

    const out = readWorkspaceBasePython(repo, 'HEAD')
    assert.strictEqual(out.ok, true)
    assert.deepStrictEqual(
      out.pyFiles.map((f) => f.relPath),
      ['pkg/src/app/models.py'],
    )
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})

const test = require('node:test')
const assert = require('node:assert')
const { parseGitNumstat } = require('../src/server')

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

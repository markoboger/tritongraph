const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createPersistence, createRuntimeServer } = require('../src/server')

async function withServer(t, run) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triton-runtime-target-topology-'))
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triton-runtime-target-workspace-'))
  t.after(() => {
    fs.rmSync(stateDir, { recursive: true, force: true })
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })
  const persistence = await createPersistence({ persistenceBackend: 'file', stateDir })
  const server = createRuntimeServer({
    persistence,
    stateDir,
    allowedRepoRoots: [workspaceDir],
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await run(baseUrl, workspaceDir)
}

test('GET target-topology 404s when no target has been saved yet', async (t) => {
  await withServer(t, async (baseUrl, workspaceDir) => {
    const res = await fetch(`${baseUrl}/api/workspace/target-topology?workspacePath=${encodeURIComponent(workspaceDir)}`)
    assert.strictEqual(res.status, 404)
    const body = await res.json()
    assert.strictEqual(body.ok, false)
    assert.strictEqual(body.error, 'target_not_found')
  })
})

test('POST target-topology writes .triton/target.ilograph.yaml, GET reads it back', async (t) => {
  await withServer(t, async (baseUrl, workspaceDir) => {
    const yaml = 'description: target\nresources: []\nperspectives: []\n'
    const postRes = await fetch(`${baseUrl}/api/workspace/target-topology`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: workspaceDir, yaml }),
    })
    assert.strictEqual(postRes.status, 200)
    const postBody = await postRes.json()
    assert.strictEqual(postBody.ok, true)
    assert.strictEqual(postBody.relPath, '.triton/target.ilograph.yaml')

    const onDisk = fs.readFileSync(path.join(workspaceDir, '.triton', 'target.ilograph.yaml'), 'utf8')
    assert.strictEqual(onDisk, yaml)

    const getRes = await fetch(`${baseUrl}/api/workspace/target-topology?workspacePath=${encodeURIComponent(workspaceDir)}`)
    assert.strictEqual(getRes.status, 200)
    const getBody = await getRes.json()
    assert.strictEqual(getBody.ok, true)
    assert.strictEqual(getBody.yaml, yaml)
  })
})

test('POST target-topology rejects a workspace outside the allowed repo roots', async (t) => {
  await withServer(t, async (baseUrl) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'triton-runtime-target-outside-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    const res = await fetch(`${baseUrl}/api/workspace/target-topology`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: outside, yaml: 'description: x\n' }),
    })
    assert.strictEqual(res.status, 403)
    const body = await res.json()
    assert.strictEqual(body.error, 'workspace_path_not_allowed')
  })
})

test('POST target-topology rejects a missing/invalid yaml body', async (t) => {
  await withServer(t, async (baseUrl, workspaceDir) => {
    const res = await fetch(`${baseUrl}/api/workspace/target-topology`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: workspaceDir }),
    })
    assert.strictEqual(res.status, 400)
    const body = await res.json()
    assert.strictEqual(body.error, 'invalid_yaml')
  })
})

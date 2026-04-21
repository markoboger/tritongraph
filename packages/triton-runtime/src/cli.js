#!/usr/bin/env node

const { startRuntimeServer } = require('./server')

const host = process.env.TRITON_RUNTIME_HOST || '127.0.0.1'
const port = Number(process.env.TRITON_RUNTIME_PORT || '4317')

startRuntimeServer({ host, port })
  .then(({ url }) => {
    process.stdout.write(`[triton-runtime] listening on ${url}\n`)
  })
  .catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    process.stderr.write(`[triton-runtime] failed to start: ${message}\n`)
    process.exitCode = 1
  })

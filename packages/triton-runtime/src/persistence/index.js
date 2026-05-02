const { createFilePersistence } = require('./filePersistence')
const { createPostgresPersistence } = require('./postgresPersistence')

/** @param {Record<string, unknown>} config runtimeConfig-style object */
async function createPersistence(config) {
  const backend = config.persistenceBackend
  if (backend === 'postgres') {
    if (!config.databaseUrl) {
      throw new Error('TRITON_PERSISTENCE_BACKEND=postgres requires DATABASE_URL')
    }
    const persistence = createPostgresPersistence(config)
    await persistence.init()
    return persistence
  }
  const persistence = createFilePersistence(config)
  await persistence.init()
  return persistence
}

module.exports = { createPersistence }

import docker06BuildSbt from '../../../docker-examples/06-scala-services/build.sbt?raw'
import docker06ApiApp from '../../../docker-examples/06-scala-services/api/src/main/scala/com/example/api/ApiApp.scala?raw'
import docker06ApiConfig from '../../../docker-examples/06-scala-services/api/src/main/scala/com/example/api/config/Config.scala?raw'
import docker06WorkerApp from '../../../docker-examples/06-scala-services/worker/src/main/scala/com/example/worker/WorkerApp.scala?raw'
import docker06WorkerConfig from '../../../docker-examples/06-scala-services/worker/src/main/scala/com/example/worker/config/WorkerConfig.scala?raw'

export const dockerScalaSbtExampleFallbacks = [
  {
    root: 'docker-examples',
    dir: '06-scala-services',
    path: 'docker-examples/06-scala-services/build.sbt',
    source: docker06BuildSbt,
  },
] as const

export const dockerScalaSourceFallbacks = [
  {
    root: 'docker-examples',
    exampleDir: '06-scala-services',
    relPath: 'api/src/main/scala/com/example/api/ApiApp.scala',
    source: docker06ApiApp,
  },
  {
    root: 'docker-examples',
    exampleDir: '06-scala-services',
    relPath: 'api/src/main/scala/com/example/api/config/Config.scala',
    source: docker06ApiConfig,
  },
  {
    root: 'docker-examples',
    exampleDir: '06-scala-services',
    relPath: 'worker/src/main/scala/com/example/worker/WorkerApp.scala',
    source: docker06WorkerApp,
  },
  {
    root: 'docker-examples',
    exampleDir: '06-scala-services',
    relPath: 'worker/src/main/scala/com/example/worker/config/WorkerConfig.scala',
    source: docker06WorkerConfig,
  },
] as const

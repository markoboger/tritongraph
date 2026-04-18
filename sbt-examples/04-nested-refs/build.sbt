// LocalProject and explicit file paths (common in larger builds).
ThisBuild / scalaVersion := "2.13.14"

lazy val root = (project in file(".")).aggregate(core, api, worker)

lazy val model = (project in file("sub/model")).settings(name := "model")

lazy val core = (project in file("sub/core")).dependsOn(model)

lazy val api = (project in file("sub/api"))
  .dependsOn(core, LocalProject("model"))

lazy val worker = (project in file("sub/worker"))
  .dependsOn(core % "compile->compile")

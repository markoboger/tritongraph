ThisBuild / scalaVersion := "3.3.3"

lazy val root = (project in file("."))
  .aggregate(api, worker)

lazy val api = (project in file("api"))
  .settings(
    name := "api",
  )

lazy val worker = (project in file("worker"))
  .settings(
    name := "worker",
  )

ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "com.example"

lazy val root = (project in file("."))
  .aggregate(core, newModule)
  .dependsOn(core)
  .settings(
    name := "single-module-demo",
    version := "0.1.0-SNAPSHOT",
  )

lazy val core = (project in file("core"))
  .settings(
    name := "core",
  )

lazy val newModule = (project in file("new-module"))
  .settings(
    name := "new-module",
  )

// Typical multi-project layout: root aggregates submodules; service depends on domain + infra.
ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "com.example"

lazy val root = (project in file("."))
  .aggregate(domain, infra, service)
  .settings(name := "multi-module-root")

lazy val domain = (project in file("modules/domain"))
  .settings(name := "domain")

lazy val infra = (project in file("modules/infra"))
  .dependsOn(domain)

lazy val service = (project in file("modules/service"))
  .dependsOn(domain, infra)

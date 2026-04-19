ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "com.example"

lazy val root = (project in file("."))
  .settings(
    name := "animal-fruit-parser-demo",
    version := "0.1.0-SNAPSHOT",
  )

ThisBuild / scalaVersion := "3.8.3"
ThisBuild / organization := "com.example"

lazy val root = (project in file("."))
  .settings(
    name := "animal-fruit-parser-demo",
    version := "0.1.0-SNAPSHOT",
    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
  )

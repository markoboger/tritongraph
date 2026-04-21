ThisBuild / scalaVersion := "3.8.3"
ThisBuild / organization := "com.example"
ThisBuild / version := "0.1.0-SNAPSHOT"

lazy val root = (project in file("."))
  .aggregate(animals, fruit)
  .settings(
    name := "animal-fruit-parser-demo",
  )

lazy val fruit = (project in file("fruit"))
  .settings(
    name := "fruit-domain",
    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
  )

lazy val animals = (project in file("animals"))
  .dependsOn(fruit)
  .settings(
    name := "animals-domain",
    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
  )

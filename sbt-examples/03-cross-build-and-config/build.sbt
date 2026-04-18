// Cross-built library + consumer; shows dependsOn with configuration (compile->test stripped to project id).
ThisBuild / scalaVersion := "2.13.14"

lazy val root = (project in file("."))
  .aggregate(lib213, app)

lazy val lib213 = (project in file("lib"))
  .settings(
    crossScalaVersions := Seq("2.13.14", "3.3.3"),
    name := "shared-lib",
  )

lazy val app = (project in file("app"))
  .dependsOn(lib213 % "compile->compile")

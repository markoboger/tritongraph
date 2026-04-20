const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const pkgPath = path.join(rootDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

function copyIntoStage(stageDir, relPath) {
  const src = path.join(rootDir, relPath)
  const dst = path.join(stageDir, 'extension', relPath)
  ensureDir(path.dirname(dst))
  fs.copyFileSync(src, dst)
}

function manifestXml() {
  const readme = 'extension/README.md'
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(pkg.name)}" Version="${esc(pkg.version)}" Publisher="${esc(pkg.publisher)}" />
    <DisplayName>${esc(pkg.displayName || pkg.name)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description || '')}</Description>
    <Categories>${esc((pkg.categories || []).join(','))}</Categories>
    <GalleryFlags>Preview</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(pkg.engines?.vscode || '*')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
    <Assets>
      <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="${readme}" Addressable="true" />
      <Asset Type="Microsoft.VisualStudio.Services.VSIXPackage" Path="extension.vsixmanifest" Addressable="true" />
      <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    </Assets>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[1.90.0,)" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/extension.vsixmanifest" ContentType="text/xml" />
</Types>
`
}

function main() {
  const outDir = path.join(rootDir, 'dist')
  const stageBase = fs.mkdtempSync(path.join(os.tmpdir(), 'triton-vsix-'))
  const stageDir = path.join(stageBase, 'stage')
  const vsixName = `${pkg.name}-${pkg.version}.vsix`
  const vsixPath = path.join(outDir, vsixName)

  ensureDir(stageDir)
  ensureDir(path.join(stageDir, 'extension'))
  ensureDir(outDir)

  for (const relPath of ['package.json', 'README.md', path.join('src', 'extension.js')]) {
    copyIntoStage(stageDir, relPath)
  }

  fs.writeFileSync(path.join(stageDir, 'extension.vsixmanifest'), manifestXml(), 'utf8')
  fs.writeFileSync(path.join(stageDir, '[Content_Types].xml'), contentTypesXml(), 'utf8')
  rimraf(vsixPath)

  cp.execFileSync('/usr/bin/zip', ['-qr', vsixPath, '.'], { cwd: stageDir, stdio: 'inherit' })
  console.log(vsixPath)
}

main()

# build-zip.ps1 — package the site into a Netlify-ready ZIP.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build-zip.ps1
#   powershell -ExecutionPolicy Bypass -File .\build-zip.ps1 -Out "C:\path\out.zip"
#
# Zips every file in this folder (including the .apk and hidden .well-known),
# excludes the .git directory, and writes the ZIP to your Downloads by default.
# Then drag the ZIP onto the Netlify "Deploys" tab to publish.

param(
  [string]$Out = "$env:USERPROFILE\Downloads\debt-tracker-deploy.zip"
)

$repo = $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $Out) { Remove-Item $Out -Force }

$bs = [char]92   # backslash
$fw = [char]47   # forward slash
$fs = [System.IO.File]::Open($Out, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)

foreach ($f in (Get-ChildItem $repo -Recurse -File -Force)) {
  $rel = $f.FullName.Substring($repo.Length + 1).Replace($bs, $fw)
  # Skip the git internals and any previously-built zip.
  if ($rel -eq ".git" -or $rel.StartsWith(".git/")) { continue }
  if ($rel -like "*.zip") { continue }
  $entry = $zip.CreateEntry($rel)
  $stream = $entry.Open()
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
}

$zip.Dispose()
$fs.Close()
"Built {0}  ({1} KB)" -f $Out, [math]::Round((Get-Item $Out).Length / 1KB, 1)

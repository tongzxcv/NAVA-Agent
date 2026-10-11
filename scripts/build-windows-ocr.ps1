# Build Windows.Media.Ocr helper with embedded sparse-package identity.
# Publisher must match the Subject of the signing certificate for the sparse MSIX.
[CmdletBinding()]
param(
  [string]$Configuration = 'Release',
  [string]$Publisher = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$ocrDir = Join-Path $projectRoot 'native\windows-ocr'
$project = Join-Path $ocrDir 'lnwjud-windows-ocr.csproj'
$sourceManifest = Join-Path $ocrDir 'ocr-helper.app.manifest'
$generatedManifest = Join-Path $ocrDir 'obj\ocr-helper.identity.manifest'
if ([string]::IsNullOrWhiteSpace($Publisher)) {
  if (-not [string]::IsNullOrWhiteSpace($env:NAVA_OCR_PUBLISHER)) {
    $Publisher = $env:NAVA_OCR_PUBLISHER
  } else {
    $Publisher = 'CN=lnwjud-windows-ocr-dev'
  }
}
if ($Publisher -notmatch '^(CN|O|OU|C|L|S|ST)=' -or $Publisher -match '[<>]') {
  throw 'Invalid OCR publisher. Supply the exact X.509 Subject of the signing certificate.'
}
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) { throw 'dotnet CLI not found. Install the .NET 8 SDK.' }
New-Item -ItemType Directory -Path (Split-Path $generatedManifest) -Force | Out-Null
[xml]$manifest = Get-Content -LiteralPath $sourceManifest -Raw
$identity = $manifest.SelectSingleNode("//*[local-name()='msix' and namespace-uri()='urn:schemas-microsoft-com:msix.v1']")
if ($null -eq $identity) { throw 'OCR helper app manifest lacks msix identity metadata.' }
$identity.SetAttribute('publisher', $Publisher)
$manifest.Save($generatedManifest)
& dotnet restore $project --locked-mode -r win-x64
if ($LASTEXITCODE -ne 0) { throw 'Windows OCR locked dependency restore failed.' }
& dotnet publish $project --no-restore -c $Configuration -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishReadyToRun=true "-p:ApplicationManifest=$generatedManifest" -o (Join-Path $ocrDir 'bin')
if ($LASTEXITCODE -ne 0) { throw 'Windows OCR publish failed.' }
$helper = Join-Path $ocrDir 'bin\lnwjud-windows-ocr.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
  throw "Windows OCR helper exe missing after publish: $helper"
}
Write-Host 'Windows OCR helper built with embedded MSIX identity metadata.'
Write-Host "Built $helper"

# Sparse identity for the Windows OCR helper.
# Default is PREPARE-ONLY: does not sign, trust certificates, or register a package.
# Registration requires -Register -ConfirmRegistration with a trusted release PFX.
[CmdletBinding()]
param(
  [string]$Publisher = '',
  [string]$ReleaseCertPfx = '',
  [string]$ReleaseCertPassword = '',
  [string]$ExternalLocation = '',
  [switch]$Register,
  [switch]$ConfirmRegistration
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ocrDir = Join-Path $root 'native\windows-ocr'
$defaultExternal = Join-Path $ocrDir 'bin'
$helper = Join-Path $defaultExternal 'lnwjud-windows-ocr.exe'
$kitRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
function Find-SdkTool([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if (Test-Path -LiteralPath $kitRoot) {
    $candidates = @(Get-ChildItem -LiteralPath $kitRoot -Directory | Where-Object { $_.Name -match '^\d+\.' } | Sort-Object Name -Descending)
    foreach ($version in $candidates) {
      $tool = Join-Path (Join-Path $version.FullName 'x64') $Name
      if (Test-Path -LiteralPath $tool -PathType Leaf) { return $tool }
    }
  }
  throw "Windows SDK tool $Name not found. Install Windows SDK."
}

if ($ConfirmRegistration -and -not $Register) { throw '-ConfirmRegistration requires -Register.' }
if ($Register -and -not $ConfirmRegistration) { throw 'Registration is opt-in; supply both -Register and -ConfirmRegistration.' }
if ($Register -and [string]::IsNullOrWhiteSpace($ReleaseCertPfx)) {
  throw 'Registration requires a real trusted signing PFX. Self-signed development trust is not installed automatically.'
}
if (-not [string]::IsNullOrWhiteSpace($ReleaseCertPfx)) {
  if (-not (Test-Path -LiteralPath $ReleaseCertPfx -PathType Leaf)) { throw 'Release signing PFX not found.' }
  if ([string]::IsNullOrWhiteSpace($ReleaseCertPassword)) { throw 'Release PFX password is required.' }
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $ReleaseCertPfx, $ReleaseCertPassword,
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
  )
  try {
    if ([string]::IsNullOrWhiteSpace($Publisher)) { $Publisher = $cert.Subject }
    if ($Publisher -ne $cert.Subject) { throw 'Sparse package publisher must exactly match release certificate subject.' }
  } finally { $cert.Dispose() }
}
if ([string]::IsNullOrWhiteSpace($Publisher)) {
  $Publisher = if (-not [string]::IsNullOrWhiteSpace($env:NAVA_OCR_PUBLISHER)) { $env:NAVA_OCR_PUBLISHER } else { 'CN=lnwjud-windows-ocr-dev' }
}
if ($Publisher -notmatch '^(CN|O|OU|C|L|S|ST)=' -or $Publisher -match '[<>]') {
  throw 'Invalid package publisher distinguished name.'
}

if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
  throw 'Windows OCR helper is not built. Run scripts\build-windows-ocr.ps1 first.'
}
$mt = Find-SdkTool 'mt.exe'
$makeappx = Find-SdkTool 'makeappx.exe'
$stage = Join-Path $ocrDir ('obj\sparse-staging-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# Verify identity embedded in the EXE matches the package to be registered.
$extracted = Join-Path $ocrDir ('obj\embedded-helper-' + [guid]::NewGuid().ToString('N') + '.manifest')
& $mt "-inputresource:$helper;#1" "-out:$extracted"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $extracted -PathType Leaf)) {
  throw 'OCR helper does not contain the required embedded application manifest.'
}
[xml]$embedded = Get-Content -LiteralPath $extracted -Raw
$appIdentity = $embedded.SelectSingleNode("//*[local-name()='msix' and namespace-uri()='urn:schemas-microsoft-com:msix.v1']")
if ($null -eq $appIdentity -or $appIdentity.GetAttribute('publisher') -cne $Publisher -or
    $appIdentity.GetAttribute('packageName') -cne 'com.lnwjud.windowsocr' -or
    $appIdentity.GetAttribute('applicationId') -cne 'LnwjudWindowsOcr') {
  throw 'Embedded OCR executable package identity does not match sparse manifest publisher/name/application.'
}

$ver = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($ver -notmatch '^\d+\.\d+\.\d+$') { throw 'Root package version is not a valid x.y.z version.' }
[xml]$xml = Get-Content -LiteralPath (Join-Path $ocrDir 'sparse-package.appxmanifest') -Raw
$identity = $xml.SelectSingleNode("//*[local-name()='Identity']")
$identity.SetAttribute('Publisher', $Publisher)
$identity.SetAttribute('Version', ($ver + '.0'))
$xml.Save((Join-Path $stage 'AppxManifest.xml'))
# Pack only the identity manifest: logo files live at the external app location.
$msix = Join-Path $ocrDir 'obj\lnwjud-windows-ocr.sparse.msix'
& $makeappx pack /o /nv /d $stage /p $msix
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $msix -PathType Leaf)) {
  throw 'Windows SDK MakeAppx sparse package validation/packaging failed.'
}
Write-Output ('SPARSE_PREPARED=' + $msix)
Write-Output ('OCR_PACKAGE_PUBLISHER=' + $Publisher)
Write-Output ('OCR_PACKAGE_VERSION=' + $ver + '.0')

if (-not $Register) {
  Write-Output 'PREPARE_ONLY=true; no certificate changes or package registration performed.'
  return
}
$signTool = Find-SdkTool 'signtool.exe'
if ([string]::IsNullOrWhiteSpace($ExternalLocation)) {
  throw '-ExternalLocation must specify the final installed windows-ocr directory when registering.'
}
$external = (Resolve-Path -LiteralPath $ExternalLocation).Path
$installedHelper = Join-Path $external 'lnwjud-windows-ocr.exe'
if (-not (Test-Path -LiteralPath $installedHelper -PathType Leaf)) { throw 'ExternalLocation lacks OCR helper.' }
foreach ($asset in @('StoreLogo.png','Square150x150Logo.png','Square44x44Logo.png')) {
  if (-not (Test-Path -LiteralPath (Join-Path $external ('Assets\' + $asset)) -PathType Leaf)) {
    throw "ExternalLocation missing required OCR sparse asset: $asset"
  }
}
# Do not link a trusted sparse identity to a mismatched/unsigned installed EXE.
$installedSig = Get-AuthenticodeSignature -LiteralPath $installedHelper
if ($installedSig.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $null -eq $installedSig.SignerCertificate -or $installedSig.SignerCertificate.Subject -cne $Publisher) {
  throw 'Installed OCR executable is not signed by the sparse package publisher.'
}
$installedManifest = Join-Path $stage 'installed-helper.manifest'
& $mt "-inputresource:$installedHelper;#1" "-out:$installedManifest"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installedManifest -PathType Leaf)) {
  throw 'Installed OCR executable lacks embedded identity.'
}
[xml]$installedXml = Get-Content -LiteralPath $installedManifest -Raw
$installedIdentity = $installedXml.SelectSingleNode("//*[local-name()='msix' and namespace-uri()='urn:schemas-microsoft-com:msix.v1']")
if ($null -eq $installedIdentity -or $installedIdentity.GetAttribute('publisher') -cne $Publisher -or
    $installedIdentity.GetAttribute('packageName') -cne 'com.lnwjud.windowsocr' -or
    $installedIdentity.GetAttribute('applicationId') -cne 'LnwjudWindowsOcr') {
  throw 'Installed OCR executable identity does not match signed sparse package.'
}
& $signTool sign /fd SHA256 /f $ReleaseCertPfx /p $ReleaseCertPassword $msix
if ($LASTEXITCODE -ne 0) { throw 'Sparse MSIX signing failed.' }
& $signTool verify /pa $msix
if ($LASTEXITCODE -ne 0) { throw 'Sparse MSIX signing certificate is not trusted.' }
# No implicit re-registration or removal of an existing package on conflict.
Add-AppxPackage -Path $msix -ExternalLocation $external -ErrorAction Stop
$probe = '{"op":"probe"}' | & $installedHelper
if ($LASTEXITCODE -ne 0 -or $probe -notmatch '"package_identity":\s*true') {
  throw 'OCR sparse registration did not grant package identity to installed helper.'
}
Write-Output 'OCR_PACKAGE_REGISTERED_AND_PROBED=true'

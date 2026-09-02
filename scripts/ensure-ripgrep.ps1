[CmdletBinding()]
param(
    [string]$InstallDirectory
)

$ErrorActionPreference = 'Stop'

$version = '15.1.0'
$assetName = "ripgrep-$version-x86_64-pc-windows-msvc.zip"
$downloadUri = "https://github.com/BurntSushi/ripgrep/releases/download/$version/$assetName"
$expectedSha256 = '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a'

if ([string]::IsNullOrWhiteSpace($InstallDirectory)) {
    $temporaryRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { [IO.Path]::GetTempPath() } else { $env:RUNNER_TEMP }
    $InstallDirectory = Join-Path $temporaryRoot 'nava-ripgrep'
}

$existing = Get-Command rg.exe -ErrorAction SilentlyContinue
if ($null -eq $existing) { $existing = Get-Command rg -ErrorAction SilentlyContinue }
if ($null -ne $existing) {
    $versionOutput = & $existing.Source --version
    if ($LASTEXITCODE -ne 0) { throw "Existing ripgrep failed to execute: $($existing.Source)" }
    Write-Host "ripgrep already available: $($versionOutput | Select-Object -First 1)"
    exit 0
}

$downloadDirectory = Join-Path $InstallDirectory 'download'
$extractDirectory = Join-Path $InstallDirectory 'payload'
$archivePath = Join-Path $downloadDirectory $assetName
New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $extractDirectory -Force | Out-Null

$downloaded = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        Invoke-WebRequest -Uri $downloadUri -OutFile $archivePath -UseBasicParsing -Headers @{ 'User-Agent' = 'NAVA-Agent-CI' }
        $downloaded = $true
        break
    } catch {
        if ($attempt -eq 3) { throw }
        Write-Warning "ripgrep download attempt $attempt failed; retrying."
        Start-Sleep -Seconds (2 * $attempt)
    }
}
if (-not $downloaded -or -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw 'ripgrep archive was not downloaded'
}

$actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
    throw "ripgrep SHA-256 mismatch for $assetName"
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
$binary = Get-ChildItem -LiteralPath $extractDirectory -Filter 'rg.exe' -File -Recurse | Select-Object -First 1
if ($null -eq $binary) { throw 'ripgrep archive did not contain rg.exe' }

$targetPath = Join-Path $InstallDirectory 'rg.exe'
Copy-Item -LiteralPath $binary.FullName -Destination $targetPath -Force
if ($null -ne $env:GITHUB_PATH -and $env:GITHUB_PATH.Length -gt 0) {
    [IO.File]::AppendAllText($env:GITHUB_PATH, "$InstallDirectory$([Environment]::NewLine)", [Text.Encoding]::UTF8)
}
$env:Path = "$InstallDirectory;$env:Path"

$installedVersion = & $targetPath --version
if ($LASTEXITCODE -ne 0) { throw "Downloaded ripgrep failed to execute: $targetPath" }
Write-Host "Installed ripgrep: $($installedVersion | Select-Object -First 1)"

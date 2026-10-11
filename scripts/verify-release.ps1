[CmdletBinding()]
param([switch]$SourceOnlyCI)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

function Invoke-ReleaseStage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    Write-Host "==> $Name"
    & pnpm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Release stage '$Name' failed with exit code $LASTEXITCODE"
    }
}

function Assert-RepositoryChecks {
    Write-Host '==> git diff --check'
    & git diff --check
    if ($LASTEXITCODE -ne 0) {
        throw "git diff --check failed with exit code $LASTEXITCODE"
    }

    $trackedFiles = @(git ls-files)
    $forbiddenTrackedFiles = @($trackedFiles | Where-Object {
        $normalized = $_.Replace('\', '/')
        (($normalized -match '(^|/)(\.env|\.env\..+)$') -and ($normalized -notmatch '(^|/)\.env\.example$')) -or
        ($normalized -match '(^|/)(.+\.(pem|key)|id_rsa.*|id_ed25519.*|\.ssh/.*|\.aws/.*|credentials\.json)$')
    })
    if ($forbiddenTrackedFiles.Count -gt 0) {
        throw "Forbidden secret-like tracked paths found: $($forbiddenTrackedFiles -join ', ')"
    }
}

Push-Location $repositoryRoot
try {
    Invoke-ReleaseStage 'install --frozen-lockfile' @('install', '--frozen-lockfile')
    Invoke-ReleaseStage 'lint' @('lint')
    Invoke-ReleaseStage 'typecheck' @('typecheck')
    Invoke-ReleaseStage 'test' @('test')
    Invoke-ReleaseStage 'test:acceptance' @('test:acceptance')
    Invoke-ReleaseStage 'test:integration' @('test:integration')
    Invoke-ReleaseStage 'test:e2e' @('test:e2e')
    Invoke-ReleaseStage 'build' @('build')
    Invoke-ReleaseStage 'docs:tools:check' @('docs:tools:check')
    Invoke-ReleaseStage 'test:packaging' @('test:packaging')
    Invoke-ReleaseStage 'test:release-gate' @('test:release-gate')
    Invoke-ReleaseStage 'test:release-extras' @('test:release-extras')
    Invoke-ReleaseStage 'package:windows' @('package:windows')

    $installerDirectory = Join-Path $repositoryRoot 'apps\desktop\dist\installers'
    if (-not (Test-Path -LiteralPath $installerDirectory -PathType Container)) {
        throw "Packaged-app smoke could not find installer directory: $installerDirectory"
    }
    $rootPackage = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
    $expectedInstallerName = "nava-agent-Setup-$($rootPackage.version).exe"
    $expectedInstaller = Join-Path $installerDirectory $expectedInstallerName
    if (-not (Test-Path -LiteralPath $expectedInstaller -PathType Leaf)) {
        throw "Packaged-app smoke could not find the versioned installer '$expectedInstallerName' in: $installerDirectory"
    }
    Write-Host "Packaged-app smoke artifact: $expectedInstaller"

    # Source-only CI verifies the actual packaging output, but does not create
    # a public release. The tag-driven release workflow always checks real
    # trusted signatures before publishing a Windows installer.
    if ($SourceOnlyCI) {
        if ($env:GITHUB_ACTIONS -ne 'true' -or
            $env:GITHUB_EVENT_NAME -notin @('push', 'pull_request') -or
            $env:GITHUB_REF -notmatch '^refs/(heads|pull)/') {
            throw 'Unsigned source CI mode is restricted to GitHub branch or pull request verification; never release tags.'
        }
        Write-Host 'Source-only CI packaging verified; unsigned artifacts cannot be published as a signed release.'
    }
    else {
    # A builder log line saying "signing" does not establish that a signature
    # was actually embedded. Require a trusted Authenticode signature for each
    # executable shipped by the release before publishing a public installer.
    $requiredSignedExecutables = @(
        $expectedInstaller
        (Join-Path $installerDirectory 'win-unpacked\NAVA Agent.exe')
        (Join-Path $installerDirectory 'win-unpacked\resources\windows-ocr\lnwjud-windows-ocr.exe')
    )
    foreach ($signedExecutable in $requiredSignedExecutables) {
        if (-not (Test-Path -LiteralPath $signedExecutable -PathType Leaf)) {
            throw "Required signed release executable missing: $signedExecutable"
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $signedExecutable
        if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
            throw "Public NAVA release blocked: Authenticode signature is $($signature.Status) for $signedExecutable"
        }
        if ($null -eq $signature.SignerCertificate -or $signature.SignerCertificate.NotAfter -le (Get-Date)) {
            throw "Public NAVA release blocked: missing or expired signing certificate for $signedExecutable"
        }
    }

    # Even a signed helper cannot acquire its MSIX identity if it was compiled
    # with the development publisher instead of the signing certificate subject.
    $ocrIdentityManifest = Join-Path $repositoryRoot 'native\windows-ocr\obj\ocr-helper.identity.manifest'
    if (-not (Test-Path -LiteralPath $ocrIdentityManifest -PathType Leaf)) {
        throw 'Signed release blocked: generated OCR executable identity manifest is absent.'
    }
    [xml]$ocrEmbeddedIdentity = Get-Content -LiteralPath $ocrIdentityManifest -Raw
    $ocrMsix = $ocrEmbeddedIdentity.SelectSingleNode("//*[local-name()='msix' and namespace-uri()='urn:schemas-microsoft-com:msix.v1']")
    $ocrExecutable = Join-Path $installerDirectory 'win-unpacked\resources\windows-ocr\lnwjud-windows-ocr.exe'
    $ocrCert = (Get-AuthenticodeSignature -LiteralPath $ocrExecutable).SignerCertificate
    if ($null -eq $ocrMsix -or $null -eq $ocrCert -or
        $ocrMsix.GetAttribute('publisher') -cne $ocrCert.Subject -or
        $ocrMsix.GetAttribute('packageName') -cne 'com.lnwjud.windowsocr' -or
        $ocrMsix.GetAttribute('applicationId') -cne 'LnwjudWindowsOcr') {
        throw 'Signed release blocked: OCR executable MSIX publisher/name/application does not match certificate.'
    }

    }

    Assert-RepositoryChecks
    Write-Host 'Release verification gate completed.'
}
finally {
    Pop-Location
}

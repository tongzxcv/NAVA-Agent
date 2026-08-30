[CmdletBinding()]
param(
    [string]$OutputDirectory = 'diagnostics\windows-e2e'
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$processes = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('electron.exe', 'node.exe', 'taskkill.exe')
} | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate)
ConvertTo-Json -InputObject @($processes) -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'processes.json') -Encoding utf8

$processIds = @($processes | ForEach-Object { [uint32]$_.ProcessId })
$connections = if ($processIds.Count -eq 0) {
    @()
} else {
    @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
        $processIds -contains $_.OwningProcess
    } | Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess)
}
ConvertTo-Json -InputObject @($connections) -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'connections.json') -Encoding utf8

$temporaryRoots = @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'lnwjud-*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 200 FullName, CreationTimeUtc, LastWriteTimeUtc)
ConvertTo-Json -InputObject @($temporaryRoots) -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'temporary-roots.json') -Encoding utf8

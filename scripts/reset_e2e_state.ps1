#!/usr/bin/env pwsh

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$lockFile = Join-Path $rootDir '.tmp/playwright-e2e.lock'
$e2ePort = if ($env:E2E_PORT) { [int]$env:E2E_PORT } else { 3345 }

Write-Host 'Resetting Playwright E2E state...'

Write-Host '1) Stopping stale Playwright / Adonis test server processes'
$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match '^(node|pwsh|powershell)(\.exe)?$' -and
    $_.CommandLine -and
    ($_.CommandLine -match 'playwright(\.cmd)?\s+test' -or $_.CommandLine -match 'node\s+ace\s+serve')
  }

foreach ($process in $processes) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {
    # Ignore races where process exits before it can be stopped.
  }
}

Write-Host '2) Removing E2E run lock'
if (Test-Path $lockFile) {
  Remove-Item $lockFile -Force
}

Write-Host "3) Releasing E2E port $e2ePort"
$portOwners = Get-NetTCPConnection -LocalPort $e2ePort -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

foreach ($ownerPid in $portOwners) {
  if ($ownerPid -and $ownerPid -ne $PID) {
    try {
      Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    } catch {
      # Ignore processes that are already gone or cannot be terminated.
    }
  }
}

Write-Host '4) Loading test environment'
$envFile = Join-Path $rootDir '.env.test'
if (-not (Test-Path $envFile)) {
  throw "Required file '$envFile' not found."
}

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }

  $index = $line.IndexOf('=')
  if ($index -lt 1) { return }

  $name = $line.Substring(0, $index)
  $value = $line.Substring($index + 1)
  [System.Environment]::SetEnvironmentVariable($name, $value)
}

Write-Host '5) Rebuilding test database schema'
Push-Location $rootDir
try {
  node ace migration:fresh --force
  if ($LASTEXITCODE -ne 0) {
    throw "node ace migration:fresh --force failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Host 'E2E state reset complete.'

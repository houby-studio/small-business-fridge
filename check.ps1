#!/usr/bin/env pwsh
<#
.SYNOPSIS
Run all quality gates (PowerShell).

.DESCRIPTION
PowerShell equivalent of ./check.sh

.PARAMETER --skip-tests
Skip database migrations and test suites.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$skipTests = $false
foreach ($arg in $args) {
  if ($arg -eq '--skip-tests') {
    $skipTests = $true
  }
}

$PASS = '✔'
$FAIL = '✖'
$STEP = '»'

function Run-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Label,

    [Parameter(Mandatory = $true)]
    [scriptblock] $Command
  )

  Write-Host ''
  Write-Host "$STEP $Label..."

  try {
    & $Command
    if ($LASTEXITCODE -ne 0) {
      throw "Exit code $LASTEXITCODE"
    }
    Write-Host "$PASS $Label passed"
  }
  catch {
    Write-Host "$FAIL $Label FAILED" -ForegroundColor Red
    if ($_.Exception -and $_.Exception.Message) {
      Write-Host $_.Exception.Message -ForegroundColor DarkRed
    }
    exit 1
  }
}

Write-Host '================================================'
Write-Host '  SBF Quality Gate'
Write-Host '================================================'

Run-Step 'ESLint' { npm run lint }
Run-Step 'Prettier' { npx prettier --check . }
Run-Step 'TypeScript' { npm run typecheck }

if ($skipTests) {
  Write-Host ''
  Write-Host '⚠ Tests skipped (--skip-tests)' -ForegroundColor Yellow
}
else {
  # Load test environment from .env.test (equivalent to `set -a; source .env.test; set +a`)
  try {
    $envFile = '.env.test'

    if (-not (Test-Path $envFile)) {
      throw "Required file '$envFile' not found."
    }

    Get-Content $envFile | ForEach-Object {
      $line = $_.Trim()
      if (-not $line) { return }
      if ($line.StartsWith('#')) { return }

      $index = $line.IndexOf('=')
      if ($index -lt 1) { return }

      $name = $line.Substring(0, $index)
      $value = $line.Substring($index + 1)

      [System.Environment]::SetEnvironmentVariable($name, $value)
    }
  }
  catch {
    Write-Host "$FAIL Loading .env.test FAILED" -ForegroundColor Red
    if ($_.Exception -and $_.Exception.Message) {
      Write-Host $_.Exception.Message -ForegroundColor DarkRed
    }
    exit 1
  }

  Run-Step 'Ensure test database exists' { node --import=tsx scripts/ensure_test_db.ts }
  Run-Step 'Test migrations' { node ace migration:run --force }
  Run-Step 'Unit + Functional tests' { node ace test --no-color }
  Run-Step 'Reset E2E state' { npm run test:e2e:reset }
  Run-Step 'Playwright E2E tests' { npm run test:e2e }
}

Write-Host ''
Write-Host '================================================'
Write-Host "  $PASS All checks passed!"
Write-Host '================================================'

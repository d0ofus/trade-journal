param([Parameter(Mandatory = $true)][string]$NodePath, [switch]$Cache, [switch]$Baseline)
$ErrorActionPreference = 'Stop'
# This launches only the prepared, disposable production-build copy. It never loads .env.local.
$phaseRoot = Join-Path $env:TEMP 'trade-workstation-phase2'
$buildDirectory = Join-Path $phaseRoot $(if ($Baseline) { 'baseline-build' } else { 'build' })
if (!(Test-Path -LiteralPath (Join-Path $buildDirectory '.next\BUILD_ID'))) {
    throw 'Prepare and verify the isolated phase-two production build first.'
}
$nodeVersion = & $NodePath --version
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Use Node 22 or newer for validation.' }
if (!$env:DATABASE_URL -or $env:DIRECT_URL -ne $env:DATABASE_URL) { throw 'Set both URLs to the same isolated browser-test database first.' }
$databaseTarget = [Uri]$env:DATABASE_URL
if ($databaseTarget.Host -ne '127.0.0.1' -or $databaseTarget.Port -ne 55439 -or $databaseTarget.AbsolutePath -ne '/trades_workstation_auth_test' -or $databaseTarget.Query) {
    throw 'This launcher accepts only the disposable local browser-test database.'
}
$env:ALLOW_TEST_DATABASE_MUTATIONS = '1'
$env:TRADES_WORKSTATION_ENABLED = '1'
$env:TRADES_WORKSTATION_PREVIEW = '1'
$env:TRADES_CHART_PROVIDER = 'legacy'
$env:NODE_ENV = 'production'
$env:E2E_DEMO_ONLY_WRITES = '1'
$env:NEXTAUTH_URL = 'http://127.0.0.1:3101'
# Public synthetic login for this loopback test process; never use these values in Vercel.
$env:AUTH_USERNAME = 'phase2-reviewer'
$env:AUTH_PASSWORD = 'phase2-local-test-only'
$env:NEXTAUTH_SECRET = 'isolated-phase-two-test-secret-not-production'
$networkFence = ([Uri](Join-Path $PSScriptRoot 'workstation-test-network.mjs')).AbsoluteUri
if ($Cache) {
    $env:TRADES_CANDLE_CACHE_ENABLED = '1'
    $env:TRADES_CANDLE_PREPARE_ENABLED = '1'
    $env:TRADES_CHART_PROVIDER = 'alpaca'
    $env:TRADES_ALPACA_API_KEY_ID = 'isolated-dummy-key'
    $env:TRADES_ALPACA_API_SECRET_KEY = 'isolated-dummy-secret'
    $env:TRADES_ALPACA_DATA_FEED = 'sip'
    $env:TRADES_ALPACA_ADJUSTMENT = 'raw'
    $env:WORKSTATION_TEST_CANDLES_FILE = Join-Path $phaseRoot 'alpaca-production-diagnostic.json'
    $env:WORKSTATION_TEST_PROVIDER_LOG = Join-Path $phaseRoot 'cache-provider.log'
    $networkFence = ([Uri](Join-Path $PSScriptRoot 'workstation-cache-test-network.mjs')).AbsoluteUri
}
Push-Location -LiteralPath $buildDirectory
try {
    & $NodePath --import $networkFence node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3101
    if ($LASTEXITCODE -ne 0) { throw "The isolated test server exited with code $LASTEXITCODE." }
}
finally { Pop-Location }

# Kör endast favoritvinst-migrationen mot Supabase (kräver databaslösenord).
param([string]$DbPassword = $env:SUPABASE_DB_PASSWORD)

$projectRef = "revmfdtofyewbwwdcrju"
$repoRoot = Join-Path $PSScriptRoot ".."
$migration = Join-Path $repoRoot "supabase\migrations\20260528140000_trav_favorite_win_stats.sql"

Push-Location $repoRoot

npx tsx scripts/apply-trav-favorite-win-migration.ts 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Tabellerna finns redan." -ForegroundColor Green
  Pop-Location
  exit 0
}

if (-not $DbPassword) {
  Write-Host "Satt SUPABASE_DB_PASSWORD eller ange -DbPassword." -ForegroundColor Yellow
  Write-Host "Eller kör SQL manuellt: npm run trav:favorite-win:migration:sql"
  Pop-Location
  exit 1
}

$encoded = [uri]::EscapeDataString($DbPassword)
$dbUrl = "postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

Get-Content $migration -Raw | npx supabase db execute --db-url $dbUrl 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  $dbUrl = "postgresql://postgres.${projectRef}:${encoded}@db.${projectRef}.supabase.co:5432/postgres"
  Get-Content $migration -Raw | npx supabase db execute --db-url $dbUrl 2>&1 | Out-Host
}

npx tsx scripts/apply-trav-favorite-win-migration.ts
Pop-Location

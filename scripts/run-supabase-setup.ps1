# Kor SQL mot Supabase direkt (krav: databaslosenord).
param(
  [string]$DbPassword
)

$projectRef = "revmfdtofyewbwwdcrju"
$repoRoot = Join-Path $PSScriptRoot ".."

function Test-DatabaseReady {
  Write-Host ""
  Write-Host "Verifierar databasen..." -ForegroundColor DarkGray
  npm run test:db
  return ($LASTEXITCODE -eq 0)
}

Push-Location $repoRoot

if (Test-DatabaseReady) {
  Write-Host ""
  Write-Host "Databasen ar redan redo." -ForegroundColor Green
  Pop-Location
  exit 0
}

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Databasen ar inte fullstandigt initialiserad annu." -ForegroundColor Yellow
}

if (-not $DbPassword) {
  Write-Host ""
  Write-Host "Hitta ditt databaslosenord har:" -ForegroundColor Cyan
  Write-Host "  https://supabase.com/dashboard/project/$projectRef/settings/database"
  Write-Host ""
  Write-Host "  -> Database Settings -> Database password"
  Write-Host "  (Losenordet du valde nar du skapade projektet)"
  Write-Host ""
  $secure = Read-Host "Klistra in database password" -AsSecureString
  $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

if (-not $DbPassword) {
  Write-Error "Inget losenord angivet."
  exit 1
}

$encoded = [uri]::EscapeDataString($DbPassword)
$hosts = @(
  "postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres.${projectRef}:${encoded}@db.${projectRef}.supabase.co:5432/postgres"
)

$ok = $false
foreach ($dbUrl in $hosts) {
  Write-Host "Forsoker ansluta och kora migrationer..." -ForegroundColor DarkGray
  npx supabase db push --include-all --yes --db-url $dbUrl 2>&1 | Out-Host
  if ($LASTEXITCODE -eq 0) {
    $ok = $true
    break
  }
}

if (Test-DatabaseReady) {
  Write-Host ""
  if ($ok) {
    Write-Host "Migrationer klara och databasen verifierad." -ForegroundColor Green
  } else {
    Write-Host "Databasen var redan satt upp trots migrationsfelet." -ForegroundColor Green
  }
  Pop-Location
  exit 0
} else {
  Write-Host ""
  Write-Host "Kunde inte fa databasen i fungerande skick automatiskt." -ForegroundColor Red
  Write-Host "Kor i stallet: npm run setup:sql" -ForegroundColor Yellow
  Write-Host "(kopierar SQL + oppnar webblasaren - klistra in och klicka Run)"
  Pop-Location
  exit 1
}

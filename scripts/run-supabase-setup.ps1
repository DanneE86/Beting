# Kor SQL mot Supabase direkt (krav: databaslosenord).
param(
  [string]$DbPassword
)

$projectRef = "revmfdtofyewbwwdcrju"
$sqlFile = Join-Path (Join-Path $PSScriptRoot "..") "supabase\setup-complete.sql"

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
  "postgresql://postgres.${projectRef}:${encoded}@db.${projectRef}.supabase.co:5432/postgres",
  "postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
)

Push-Location (Join-Path $PSScriptRoot "..")
$ok = $false
foreach ($dbUrl in $hosts) {
  Write-Host "Forsoker ansluta..." -ForegroundColor DarkGray
  npx supabase db query -f $sqlFile --db-url $dbUrl 2>&1 | Out-Host
  if ($LASTEXITCODE -eq 0) {
    $ok = $true
    break
  }
}
Pop-Location

if ($ok) {
  Write-Host ""
  Write-Host "Tabeller skapade! Testar..." -ForegroundColor Green
  npm run test:db
} else {
  Write-Host ""
  Write-Host "Kunde inte ansluta automatiskt." -ForegroundColor Red
  Write-Host "Kor i stallet: npm run setup:sql" -ForegroundColor Yellow
  Write-Host "(kopierar SQL + oppnar webblasaren — klistra in och klicka Run)"
  exit 1
}

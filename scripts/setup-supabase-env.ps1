# Klistra in Supabase API-nycklar i .env
param(
  [string]$AnonKey,
  [string]$ServiceRoleKey
)

$envPath = Join-Path $PSScriptRoot ".." ".env"
$examplePath = Join-Path $PSScriptRoot ".." ".env.example"

if (-not (Test-Path $envPath)) {
  Copy-Item $examplePath $envPath
}

$content = Get-Content $envPath -Raw

if ($AnonKey) {
  $content = $content -replace '(?m)^SUPABASE_PUBLISHABLE_KEY=.*$', "SUPABASE_PUBLISHABLE_KEY=$AnonKey"
  $content = $content -replace '(?m)^VITE_SUPABASE_PUBLISHABLE_KEY=.*$', "VITE_SUPABASE_PUBLISHABLE_KEY=$AnonKey"
}

if ($ServiceRoleKey) {
  $content = $content -replace '(?m)^SUPABASE_SERVICE_ROLE_KEY=.*$', "SUPABASE_SERVICE_ROLE_KEY=$ServiceRoleKey"
}

Set-Content -Path $envPath -Value $content.TrimEnd() -NoNewline
Add-Content -Path $envPath -Value ""

Write-Host "Uppdaterade .env for projekt revmfdtofyewbwwdcrju"
Write-Host ""
Write-Host "Nasta steg:"
Write-Host "1. Kor SQL: supabase/setup-complete.sql i Supabase SQL Editor"
Write-Host "   https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new"
Write-Host "2. npm run dev"

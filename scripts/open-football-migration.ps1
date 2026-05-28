# Kopierar football-migration till urklipp och oppnar Supabase SQL Editor.
$sqlPath = Join-Path (Join-Path $PSScriptRoot "..") "supabase\migrations\20260528120000_football_match_intel.sql"
$sql = Get-Content $sqlPath -Raw
Set-Clipboard -Value $sql
Start-Process "https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new"
Write-Host "Football-migration kopierad till urklipp. Klistra in (Ctrl+V) och klicka RUN." -ForegroundColor Green

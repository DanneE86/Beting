# Kopierar setup-SQL till urklipp och oppnar Supabase SQL Editor.
$sqlPath = Join-Path (Join-Path $PSScriptRoot "..") "supabase\setup-complete.sql"
$sql = Get-Content $sqlPath -Raw

Set-Clipboard -Value $sql

$url = "https://supabase.com/dashboard/project/revmfdtofyewbwwdcrju/sql/new"
Start-Process $url

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SQL ar kopierad till urklipp!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Supabase SQL Editor oppnades i webblasaren."
Write-Host ""
Write-Host "Gor nu bara detta:"
Write-Host "  1. Klicka i den stora textrutan (SQL Editor)"
Write-Host "  2. Tryck Ctrl+V  (klistra in SQL)"
Write-Host "  3. Klicka RUN  (gron knapp nere till hoger)"
Write-Host ""
Write-Host "Nar du ar klar, kor i terminalen:"
Write-Host "  node scripts/test-supabase.mjs" -ForegroundColor Yellow
Write-Host ""

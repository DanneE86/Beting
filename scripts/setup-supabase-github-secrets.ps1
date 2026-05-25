# Sätter GitHub Actions-secrets för automatisk Supabase migration deploy.
param(
  [string]$SupabaseAccessToken,
  [string]$SupabaseDbPassword,
  [string]$ProjectId
)

function Resolve-GhPath {
  $cmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $default = "C:\Program Files\GitHub CLI\gh.exe"
  if (Test-Path $default) { return $default }

  throw "GitHub CLI hittades inte. Installera med: winget install --id GitHub.cli"
}

function Read-SecretValue([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

function Get-RepoSlug {
  $remote = (git remote get-url origin).Trim()
  if ($remote -match 'github\.com[:/](.+?)(?:\.git)?$') {
    return $Matches[1]
  }
  throw "Kunde inte tolka GitHub remote: $remote"
}

$projectRef = if ($ProjectId) {
  $ProjectId
} else {
  $configPath = Join-Path (Join-Path $PSScriptRoot "..") "supabase\config.toml"
  if (-not (Test-Path $configPath)) {
    throw "supabase/config.toml saknas."
  }
  $match = Select-String -Path $configPath -Pattern 'project_id\s*=\s*"([^"]+)"' | Select-Object -First 1
  if (-not $match) {
    throw "Kunde inte hitta project_id i supabase/config.toml"
  }
  $match.Matches[0].Groups[1].Value
}

$gh = Resolve-GhPath
$repo = Get-RepoSlug

& $gh auth status | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI är inte inloggad. Kör först: & `"$gh`" auth login"
}

if (-not $SupabaseAccessToken) {
  Write-Host ""
  Write-Host "Öppnar Supabase token-sidan..." -ForegroundColor Cyan
  Start-Process "https://supabase.com/dashboard/account/tokens"
  $SupabaseAccessToken = Read-SecretValue "Klistra in SUPABASE_ACCESS_TOKEN"
}

if (-not $SupabaseDbPassword) {
  Write-Host ""
  Write-Host "Öppnar Supabase Database Settings..." -ForegroundColor Cyan
  Start-Process "https://supabase.com/dashboard/project/$projectRef/database/settings"
  $SupabaseDbPassword = Read-SecretValue "Klistra in SUPABASE_DB_PASSWORD"
}

if (-not $SupabaseAccessToken) {
  throw "SUPABASE_ACCESS_TOKEN saknas."
}

if (-not $SupabaseDbPassword) {
  throw "SUPABASE_DB_PASSWORD saknas."
}

Write-Host ""
Write-Host "Sätter GitHub-secrets för $repo..." -ForegroundColor Green

$SupabaseAccessToken | & $gh secret set SUPABASE_ACCESS_TOKEN --repo $repo
if ($LASTEXITCODE -ne 0) { throw "Misslyckades att sätta SUPABASE_ACCESS_TOKEN" }

$SupabaseDbPassword | & $gh secret set SUPABASE_DB_PASSWORD --repo $repo
if ($LASTEXITCODE -ne 0) { throw "Misslyckades att sätta SUPABASE_DB_PASSWORD" }

$projectRef | & $gh secret set SUPABASE_PROJECT_ID --repo $repo
if ($LASTEXITCODE -ne 0) { throw "Misslyckades att sätta SUPABASE_PROJECT_ID" }

Write-Host ""
Write-Host "Klart." -ForegroundColor Green
Write-Host "GitHub Actions kan nu deploya Supabase-migrationer automatiskt på push till main."
Write-Host ""
Write-Host "Nästa steg:"
Write-Host "1. Gå till GitHub -> Actions"
Write-Host "2. Kör workflowen 'Deploy Supabase Migrations' manuellt en gång om du vill verifiera direkt"
Write-Host "3. Därefter sker nya migrationer automatiskt vid push till main"

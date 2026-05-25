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

function Normalize-SecretValue([string]$Value) {
  if ($null -eq $Value) { return "" }
  $normalized = [string]$Value
  $normalized = $normalized.Replace([string][char]0x200B, "")
  $normalized = $normalized.Replace([string][char]0x200C, "")
  $normalized = $normalized.Replace([string][char]0x200D, "")
  $normalized = $normalized.Replace([string][char]0xFEFF, "")
  $normalized = $normalized.Trim()
  $normalized = $normalized.Trim('"')
  $normalized = $normalized.Trim("'")
  return $normalized
}

function Read-SecretValue([string]$Prompt, [switch]$AsSecure) {
  if ($AsSecure) {
    $secure = Read-Host $Prompt -AsSecureString
    return Normalize-SecretValue(
      [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      )
    )
  }

  return Normalize-SecretValue((Read-Host $Prompt))
}

function Read-TokenFromClipboardOrPrompt([string]$Prompt) {
  $clipboard = ""
  try {
    $clipboard = Normalize-SecretValue((Get-Clipboard -Raw))
  } catch {
    $clipboard = ""
  }

  if ($clipboard -match '^sbp_[A-Za-z0-9]+$') {
    Write-Host "Hittade giltig SUPABASE_ACCESS_TOKEN i urklipp. Använder den automatiskt." -ForegroundColor Green
    return $clipboard
  }

  Write-Host "Kopiera nu tokenen från Supabase-sidan och tryck sedan Enter här för att läsa från urklipp." -ForegroundColor Yellow
  [void](Read-Host "Tryck Enter när tokenen är kopierad")

  $clipboard = ""
  try {
    $clipboard = Normalize-SecretValue((Get-Clipboard -Raw))
  } catch {
    $clipboard = ""
  }

  if ($clipboard -match '^sbp_[A-Za-z0-9]+$') {
    Write-Host "Läste giltig SUPABASE_ACCESS_TOKEN från urklipp." -ForegroundColor Green
    return $clipboard
  }

  Write-Host "Urklipp innehöll inte en giltig token. Klistra in tokenen manuellt nedan." -ForegroundColor Yellow
  return Read-SecretValue $Prompt
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
  $SupabaseAccessToken = Read-TokenFromClipboardOrPrompt "Klistra in SUPABASE_ACCESS_TOKEN"
}

if (-not $SupabaseDbPassword) {
  Write-Host ""
  Write-Host "Öppnar Supabase Database Settings..." -ForegroundColor Cyan
  Start-Process "https://supabase.com/dashboard/project/$projectRef/database/settings"
  $SupabaseDbPassword = Read-SecretValue "Klistra in SUPABASE_DB_PASSWORD" -AsSecure
}

if (-not $SupabaseAccessToken) {
  throw "SUPABASE_ACCESS_TOKEN saknas."
}

if (-not $SupabaseDbPassword) {
  throw "SUPABASE_DB_PASSWORD saknas."
}

$SupabaseAccessToken = Normalize-SecretValue($SupabaseAccessToken)
$SupabaseDbPassword = Normalize-SecretValue($SupabaseDbPassword)

if ($SupabaseAccessToken -notmatch '^sbp_[A-Za-z0-9]+$') {
  throw "Ogiltigt SUPABASE_ACCESS_TOKEN-format. Det måste börja med sbp_ och inte innehålla citattecken eller extra text."
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

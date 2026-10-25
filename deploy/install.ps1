<#
.SYNOPSIS
  Install HATS on this machine from the published images.

.DESCRIPTION
  Needs only Docker Desktop. Creates the installation folder, fetches the
  compose file, writes .env, signs in to GitHub Container Registry, downloads
  voices, and starts everything. Safe to run again: it updates the compose
  file and images, and leaves .env and the data folder alone.

    powershell -ExecutionPolicy Bypass -File install.ps1
    powershell -ExecutionPolicy Bypass -File install.ps1 -Dir D:\hats -Version 0.1.3

  The images are private. You need a GitHub personal access token (classic)
  with the read:packages and repo scopes:
  https://github.com/settings/tokens/new?scopes=read:packages,repo
  Set GITHUB_USER and GITHUB_TOKEN to skip the prompts.
#>
param(
  [string]$Dir = 'C:\hats',
  [string]$Version = 'latest',
  [string]$Ref = 'main',
  [string[]]$Voices = @(
    'en_GB-semaine-medium', 'en_GB-vctk-medium', 'en_GB-alan-medium',
    'en_GB-jenny_dioco-medium', 'en_GB-northern_english_male-medium',
    'en_GB-southern_english_female-low'
  ),
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell redraws a progress bar per packet, which makes large
# downloads — voices are 60 MB each — many times slower.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'rockcat/HATS-agents'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host $text -ForegroundColor Red; exit 1 }

# ── Docker ───────────────────────────────────────────────────────────────────
Step 'Checking Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'Docker is not installed. Install Docker Desktop first: https://www.docker.com/products/docker-desktop/'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker is installed but not running. Start Docker Desktop and run this again.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'This Docker has no "docker compose". Update Docker Desktop.' }

# ── GitHub credentials ───────────────────────────────────────────────────────
Step 'GitHub sign-in (for the private images)'
$user = $env:GITHUB_USER
if (-not $user) { $user = Read-Host 'GitHub username' }
$token = $env:GITHUB_TOKEN
if (-not $token) {
  $secure = Read-Host 'GitHub token (read:packages, repo)' -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# ── Files ────────────────────────────────────────────────────────────────────
Step "Installing into $Dir"
New-Item -ItemType Directory -Force (Join-Path $Dir 'data\piper_voices') | Out-Null

function Get-RepoFile($path, $dest) {
  $headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github.raw' }
  $url = "https://api.github.com/repos/$Repo/contents/$path`?ref=$Ref"
  try { Invoke-WebRequest -Uri $url -Headers $headers -OutFile $dest -UseBasicParsing }
  catch { Fail "Could not download $path from $Repo ($($_.Exception.Message)). Check the token has the repo scope." }
}

$compose = Join-Path $Dir 'docker-compose.yml'
if (Test-Path $compose) { Copy-Item $compose "$compose.previous" -Force }
Get-RepoFile 'deploy/docker-compose.yml' $compose
Write-Host 'docker-compose.yml: up to date'

$envFile = Join-Path $Dir '.env'
if (Test-Path $envFile) {
  Write-Host '.env: kept as it is'
} else {
  Get-RepoFile 'deploy/.env.example' $envFile
  $anthropic = Read-Host 'Anthropic API key (Enter to fill in later)'
  $adminPassword = Read-Host 'Password for the dashboard admin (Enter for "changeme")'
  $text = Get-Content $envFile -Raw
  if ($anthropic) { $text = $text -replace '(?m)^ANTHROPIC_API_KEY=.*$', "ANTHROPIC_API_KEY=$anthropic" }
  if ($adminPassword) { $text = $text -replace '(?m)^HATS_ADMIN_PASSWORD=.*$', "HATS_ADMIN_PASSWORD=$adminPassword" }
  $text = $text -replace '(?m)^HATS_VERSION=.*$', "HATS_VERSION=$Version"
  [IO.File]::WriteAllText($envFile, $text)
  Write-Host ".env: written. Add your other keys to $envFile"
}

# ── Voices ───────────────────────────────────────────────────────────────────
# Piper voices are named <lang>_<REGION>-<name>-<quality>, which is also
# their path in the published collection.
Step 'Voices'
$voiceDir = Join-Path $Dir 'data\piper_voices'
foreach ($voice in $Voices) {
  $parts = $voice -split '-'
  if ($parts.Count -ne 3) { Write-Host "  $voice is not a Piper voice name, skipped"; continue }
  $locale, $name, $quality = $parts
  $lang = ($locale -split '_')[0]
  $base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/$lang/$locale/$name/$quality/$voice"
  foreach ($ext in '.onnx.json', '.onnx') {
    $dest = Join-Path $voiceDir "$voice$ext"
    if (Test-Path $dest) { continue }
    Write-Host "  downloading $voice$ext"
    try { Invoke-WebRequest -Uri "$base$ext" -OutFile $dest -UseBasicParsing }
    catch { Remove-Item $dest -ErrorAction SilentlyContinue; Write-Host "  could not download $voice$ext" -ForegroundColor Yellow }
  }
}

# ── Images ───────────────────────────────────────────────────────────────────
Step 'Signing in to ghcr.io and pulling images'
$token | docker login ghcr.io -u $user --password-stdin
if ($LASTEXITCODE -ne 0) { Fail 'GitHub Container Registry refused the token. It needs the read:packages scope.' }
docker compose -f $compose pull
if ($LASTEXITCODE -ne 0) { Fail 'Could not pull the images.' }

if ($NoStart) { Write-Host "`nInstalled. Start it with: docker compose -f $compose up -d"; exit 0 }

Step 'Starting'
docker compose -f $compose up -d
if ($LASTEXITCODE -ne 0) { Fail 'Could not start the containers.' }

Write-Host 'Waiting for the runner...'
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  try { Invoke-WebRequest 'http://localhost:3001/api/state' -UseBasicParsing -TimeoutSec 3 | Out-Null; $up = $true }
  catch { if ($_.Exception.Response) { $up = $true } else { Start-Sleep 3 } }
}
if (-not $up) { Fail "The runner has not answered after 3 minutes. See: docker compose -f $compose logs hats" }

Write-Host @"

HATS is running.

  Dashboard          http://localhost:3001
  Agent Library      http://localhost:3010
  Project Designer   http://localhost:3030
  Project View       http://localhost:3070

To bring a project from another machine, export it there:
  node --env-file=.env scripts/project-transfer.mjs export <project> [--credentials]
then put the zip in $Dir\data and run:
  docker compose -f $compose exec hats node scripts/project-transfer.mjs import /app/runtime_data/<project>.hats.zip

Update later by running this script again.
"@ -ForegroundColor Green

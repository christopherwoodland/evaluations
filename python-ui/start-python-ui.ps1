$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$venvPath = Join-Path $repoRoot ".venv"
$pythonExe = Join-Path $venvPath "Scripts\python.exe"
$pipExe = Join-Path $venvPath "Scripts\pip.exe"

if (-not (Test-Path $pythonExe)) {
  Write-Host "Creating virtual environment at .venv ..."
  python -m venv .venv
}

Write-Host "Installing Python UI requirements ..."
& $pipExe install -r (Join-Path $repoRoot "python-ui\requirements.txt")

Write-Host "Starting Streamlit UI ..."
& $pythonExe -m streamlit run (Join-Path $repoRoot "python-ui\app.py")

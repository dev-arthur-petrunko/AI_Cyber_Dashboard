$ErrorActionPreference = "Stop"
# Get the directory of this script
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$py = Join-Path $dir ".venv\Scripts\python.exe"
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8010

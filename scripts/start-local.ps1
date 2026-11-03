# Start the local app and its real backends in hidden windows. No models are
# downloaded here. Existing healthy services are reused, never killed.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDirectory = Join-Path $projectRoot '.local-run'
$privacyPython = Join-Path $projectRoot 'ocr/.venv/Scripts/python.exe'
$digitizerRoot = Join-Path $projectRoot 'Open-ECG-Digitizer'
$digitizerPython = Join-Path $digitizerRoot '.venv/Scripts/python.exe'
$tesseractPath = 'C:/Program Files/Tesseract-OCR/tesseract.exe'
$configPath = Join-Path $projectRoot '.env.local'

# Read only the known service keys; this never evaluates shell text from .env.
if (Test-Path -LiteralPath $configPath) {
    foreach ($line in Get-Content -LiteralPath $configPath) {
        if ($line -match '^(UPLOAD_API_URL|DEID_BACKEND_URL|ECG_DIGITIZER_URL|ECG_PYTHON|TESSERACT_CMD)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), 'Process')
        }
    }
}
if ($env:TESSERACT_CMD) { $tesseractPath = $env:TESSERACT_CMD }
foreach ($required in @($privacyPython, $digitizerPython, $tesseractPath)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Missing local prerequisite: $required" }
}
$env:TESSERACT_CMD = $tesseractPath
$env:ECG_PYTHON = $digitizerPython
$env:UPLOAD_API_URL = 'http://127.0.0.1:8001'
$env:DEID_BACKEND_URL = 'http://127.0.0.1:8002'
$env:ECG_DIGITIZER_URL = 'http://127.0.0.1:8000'
$env:ECG_CPU_THREADS = '2'
$env:OMP_NUM_THREADS = '2'
$env:ECG_RESAMPLE_SIZE = '2000'
$env:ECG_SAVE_TRACE_PLOTS = '0'
$env:PYTHONIOENCODING = 'utf-8'
Remove-Item Env:DEID_MOCK -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$env:MPLCONFIGDIR = Join-Path $runDirectory 'matplotlib'
$env:XDG_CACHE_HOME = Join-Path $runDirectory 'cache'

function Test-Endpoint([string]$url) {
    try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}

function Start-LocalProcess([string]$name, [string]$executable, [string[]]$arguments,
                            [string]$directory, [string]$readyUrl) {
    if (Test-Endpoint $readyUrl) { Write-Output "$name already reachable"; return }
    $child = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $directory `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runDirectory "$name.stdout.log") `
        -RedirectStandardError (Join-Path $runDirectory "$name.stderr.log")
    $child.Id | Set-Content -LiteralPath (Join-Path $runDirectory "$name.pid")
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Endpoint $readyUrl)) {
        $child.Refresh()
        if ($child.HasExited -or (Get-Date) -gt $deadline) {
            throw "$name did not become ready. See .local-run/$name.stderr.log"
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Output "$name ready"
}

Start-LocalProcess 'metadata' $privacyPython @('-m','uvicorn','app.main:app','--app-dir',
    ('"' + (Join-Path $projectRoot 'services/upload-api') + '"'),'--host','127.0.0.1','--port','8001','--no-access-log') `
    $projectRoot 'http://127.0.0.1:8001/health'
Start-LocalProcess 'privacy' $privacyPython @('-m','uvicorn','app.deidentify:app','--app-dir',
    ('"' + (Join-Path $projectRoot 'services/upload-api') + '"'),'--host','127.0.0.1','--port','8002','--no-access-log') `
    $projectRoot 'http://127.0.0.1:8002/ready'
Start-LocalProcess 'digitizer' $digitizerPython @('-m','uvicorn','server:app','--app-dir',
    ('"' + (Join-Path $projectRoot 'digitizer-service') + '"'),'--host','127.0.0.1','--port','8000','--no-access-log') `
    $digitizerRoot 'http://127.0.0.1:8000/health'
$nodePath = (Get-Command node -ErrorAction Stop).Source
Start-LocalProcess 'app' $nodePath @('node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3107') `
    $projectRoot 'http://127.0.0.1:3107'
Write-Output 'Open http://127.0.0.1:3107. Browser smoke fixture: ocr/samples/clean_1.jpg'
Write-Output 'The generated 12-lead fixture tests numerical stages independently; its privacy acceptance is not yet established.'

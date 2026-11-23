$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$root = 'http://127.0.0.1:3207'
$url = "$root/basso"
$ready = "$root/api/local-bass"
$logDir = Join-Path $repo '.cache\local-bass'

function Test-Studio {
    try {
        $result = Invoke-RestMethod -Uri $ready -TimeoutSec 5
        return $null -ne $result.PSObject.Properties['files']
    } catch { return $false }
}

function Test-Port {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', 3207); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

function Open-Studio {
    $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 90
    if ($page.StatusCode -ne 200 -or !$page.Content.Contains('Studio Basso')) {
        throw "La pagina di Studio Basso non e pronta. Dettagli in $logDir"
    }
    Start-Process $url
}

try {
    if (Test-Studio) {
        Open-Studio
        exit 0
    }
    if (Test-Port) {
        # Next can briefly occupy the port before it has compiled the API.
        $deadline = (Get-Date).AddSeconds(25)
        do {
            if (Test-Studio) {
                Open-Studio
                exit 0
            }
            Start-Sleep -Milliseconds 600
        } while ((Get-Date) -lt $deadline -and (Test-Port))
        if (Test-Port) { throw 'La porta 3207 e occupata e Studio Basso non risponde.' }
    }

    $node = (Get-Command node.exe).Source
    $npm = (Get-Command npm.cmd).Source
    New-Item -ItemType Directory -Force $logDir | Out-Null
    if (!(Test-Path 'node_modules\next\dist\bin\next')) {
        Write-Host 'Prima configurazione: installazione dei componenti web...'
        & $npm ci --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Non sono riuscito a installare le dipendenze Node.' }
    }
    if (!(Test-Path 'public\ffmpeg-worker\worker.js')) {
        & $node scripts/prepare-ffmpeg-worker.mjs
        if ($LASTEXITCODE) { throw 'Non sono riuscito a preparare il componente audio web di ChordMini.' }
    }
    $python = Join-Path $repo '.venv-bass\Scripts\python.exe'
    if (!(Test-Path $python)) {
        Write-Host 'Prima configurazione: preparo il motore audio...'
        & (Get-Command python.exe).Source -m venv .venv-bass
        if ($LASTEXITCODE) { throw 'Non sono riuscito a creare il motore Python.' }
    }
    & $python -c "import importlib.util, sys; sys.exit(any(importlib.util.find_spec(p) is None for p in ('librosa','numpy','scipy','soundfile','torch','h5py','pretty_midi','jams','pumpp','mir_eval','Cython','wheel')))"
    if ($LASTEXITCODE) {
        Write-Host 'Prima configurazione: installazione dei componenti audio...'
        & $python -m pip install -r local-bass\requirements.txt
        if ($LASTEXITCODE) { throw 'Non sono riuscito a installare le dipendenze audio.' }
    }
    & $python -c "import importlib.util,sys; sys.exit(importlib.util.find_spec('madmom') is None)"
    if ($LASTEXITCODE) {
        Write-Host 'Prima configurazione: preparo Madmom, il rilevatore di battute di ChordMini...'
        $wheelDir = Join-Path $logDir 'wheels'
        New-Item -ItemType Directory -Force $wheelDir | Out-Null
        $wheel = Get-ChildItem $wheelDir -Filter 'madmom-*-cp312-cp312-win_amd64.whl' | Select-Object -First 1
        if (!$wheel) {
            & $python -m pip wheel --no-deps --no-build-isolation --wheel-dir $wheelDir 'madmom @ git+https://github.com/CPJKU/madmom.git@27f032e8947204902c675e5e341a3faf5dc86dae'
            if ($LASTEXITCODE) { throw 'Non sono riuscito a compilare Madmom. Verifica Git e gli strumenti C++ di Visual Studio.' }
            $wheel = Get-ChildItem $wheelDir -Filter 'madmom-*-cp312-cp312-win_amd64.whl' | Select-Object -First 1
        }
        if (!$wheel) { throw 'Non ho trovato il pacchetto Madmom per Python 3.12 e Windows x64.' }
        & $python -m pip install --no-deps $wheel.FullName
        if ($LASTEXITCODE) { throw 'Non sono riuscito a installare Madmom.' }
    }
    $modelDir = Join-Path $repo 'python_backend\models\Chord-CNN-LSTM'
    if (!(Test-Path "$modelDir\chord_recognition.py") -or @(Get-ChildItem "$modelDir\cache_data" -Filter '*.sdict' -ErrorAction SilentlyContinue).Count -lt 5) {
        throw 'Mancano i pesi Chord-CNN-LSTM nella copia locale di ChordMini. Verifica il sottoprogetto python_backend/models/Chord-CNN-LSTM.'
    }

    $env:CHORDMINI_LOCAL_BASS = '1'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $opt = @('node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3207')
    $server = Start-Process -FilePath $node -ArgumentList $opt -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log')
    Write-Host 'Avvio Studio Basso...'
    $deadline = (Get-Date).AddSeconds(100)
    do {
        if ($server.HasExited) { throw "Il server si e fermato. Dettagli in $logDir\server-error.log" }
        if (Test-Studio) {
            Open-Studio
            exit 0
        }
        Start-Sleep -Milliseconds 600
    } while ((Get-Date) -lt $deadline)
    throw "Studio Basso non risponde. Dettagli in $logDir"
} catch {
    [Console]::Error.WriteLine($_.ToString())
    exit 1
}

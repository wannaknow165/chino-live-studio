$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$learningHome = Join-Path $env:USERPROFILE 'CHINO-Learning'
New-Item -ItemType Directory -Path $learningHome -Force | Out-Null
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Start-Process -FilePath $nodePath -ArgumentList 'learning-worker.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $learningHome 'worker.log') -RedirectStandardError (Join-Path $learningHome 'worker-error.log')

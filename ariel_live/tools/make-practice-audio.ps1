param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'test-fixtures\speech'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$cases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'practice-audio-cases.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$rows = @()
try {
    foreach ($case in $cases) {
        $target = Join-Path $OutputDirectory ($case.id + '.wav')
        $synth.SelectVoice($case.voice)
        $synth.SetOutputToWaveFile($target)
        $synth.Speak($case.text)
        $synth.SetOutputToNull()
        $rows += [PSCustomObject]@{ id=$case.id; file=($case.id + '.wav'); text=$case.text; language=$case.language; voice=$case.voice; synthetic=$true; sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower(); expectedFragments=$case.expectedFragments; expectedActions=$case.expectedActions }
    }
} finally { $synth.Dispose() }
$manifest = Join-Path $OutputDirectory 'manifest.json'
[IO.File]::WriteAllText($manifest, (ConvertTo-Json -InputObject $rows -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output "Created $($rows.Count) synthetic practice recordings: $manifest"

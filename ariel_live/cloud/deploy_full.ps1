# Full box → Hetzner: effects desk (7777) + Codex's Chino studio / specials panel (7780), with all the videos.
# Runs in the background and writes progress to %TEMP%\ariel_deploy.log
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$key  = "$env:USERPROFILE\.ssh\hetzner_ax42"
$host_ = 'root@65.108.36.178'
$pkg  = "$env:TEMP\ariel_full.tgz"
$log  = "$env:TEMP\ariel_deploy.log"
"start $(Get-Date)" | Out-File $log
$stage = "$env:TEMP\ariel_stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
# root files
Get-ChildItem $root -File | Where-Object { $_.Extension -in '.mjs','.json','.bat','.vbs','.md','.txt' } | Copy-Item -Destination $stage
# folders: explicit list, no junctions, no venvs/vendor/models/caches
$dirs = @('public','cloud','tools','media\bank','media\fun','media\generated','media\interactions','media\idle','media\fx','media\recordings','media\speech','media\performances','media\faces','media\overlays','media\thumbs','media\bg','media\front','media\clips','media\reference-library','data\avatars','data\heads','data\learning','data\video-director','data\reviews')
foreach ($d in $dirs) { $src = Join-Path $root $d; if (Test-Path $src) { robocopy $src (Join-Path $stage $d) /E /XJ /XD pose_venv vendor models __pycache__ node_modules /XF *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null } }
New-Item -ItemType Directory (Join-Path $stage 'data') -Force | Out-Null
Get-ChildItem (Join-Path $root 'data') -File | Where-Object { $_.Extension -in '.json','.jpg','.png','.webm' -and $_.Name -notmatch '^(stage_shot|snap_|_|edit_test)' } | Copy-Item -Destination (Join-Path $stage 'data')
"staged: {0:N0} MB" -f ((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum/1MB) | Out-File $log -Append
Push-Location $stage
tar -czf $pkg . 2>> $log
Pop-Location
"package: {0:N0} MB" -f ((Get-Item $pkg).Length/1MB) | Out-File $log -Append
scp -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=no $pkg "${host_}:/tmp/ariel_full.tgz" 2>> $log
"uploaded $(Get-Date)" | Out-File $log -Append
$remote = @'
set -e; B=/opt/ariel-effects; mkdir -p $B/app; tar xzf /tmp/ariel_full.tgz -C $B/app
cd $B/app && PATH=/opt/boostera-effects/runtime/node/bin:$PATH npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true
cp $B/app/cloud/chino-studio.service /etc/systemd/system/; systemctl daemon-reload; systemctl enable chino-studio >/dev/null
systemctl restart ariel-effects; systemctl restart chino-studio; sleep 4
systemctl is-active ariel-effects chino-studio; curl -s -o /dev/null -w "desk:%{http_code} " http://127.0.0.1:7777/; curl -s -o /dev/null -w "specials:%{http_code}\n" -H 'Host: 127.0.0.1:7780' http://127.0.0.1:7780/specials.html
'@
$remote = $remote -replace "`r",""
$remote | ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=no $host_ 'bash -s' 2>&1 | Out-File $log -Append
"done $(Get-Date)" | Out-File $log -Append

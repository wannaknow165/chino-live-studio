# Pack this folder on the PC, send it to the Hetzner box and install/update the one-box service there.
# Run:  & "C:\Users\shk\Downloads\the-voice-—-hebrew-narrator-studio\ariel_live\cloud\deploy_from_pc.ps1"
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$key  = "$env:USERPROFILE\.ssh\hetzner_ax42"
$host_ = 'root@65.108.36.178'
$pkg  = "$env:TEMP\ariel_pkg.tgz"
Push-Location $root
# everything the box needs: server, pages, tools, the generated clips + thumbs, heads/avatars, overlays.json, settings (keys)
$inc = @('server.mjs','start_ariel.vbs','public','tools','cloud','media/overlays','media/thumbs','media/faces','data/overlays.json','data/settings.json','data/heads','data/avatars','data/songs.json') | Where-Object { Test-Path $_ }
tar -czf $pkg --exclude='__pycache__' --exclude='*.pyc' $inc
Pop-Location
Write-Host ("package: {0:N1} MB" -f ((Get-Item $pkg).Length/1MB))
scp -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=no $pkg "${host_}:/tmp/ariel_pkg.tgz"
ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=no $host_ 'mkdir -p /opt/ariel-effects/app && tar xzf /tmp/ariel_pkg.tgz -C /opt/ariel-effects/app cloud/install.sh && bash /opt/ariel-effects/app/cloud/install.sh'

# Opens the CLOUD box in the browser: effects desk http://127.0.0.1:17777/  +  specials panel http://127.0.0.1:7780/specials.html
# Keeps an SSH tunnel alive in the background.
$key = "$env:USERPROFILE\.ssh\hetzner_ax42"
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -like '*17777:127.0.0.1:7777*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process ssh -ArgumentList @('-i', $key, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ServerAliveInterval=30', '-N', '-L', '17777:127.0.0.1:7777', '-L', '7780:127.0.0.1:7780', 'root@65.108.36.178') -WindowStyle Hidden
Start-Sleep 2
Start-Process "http://127.0.0.1:17777/"
Start-Process "http://127.0.0.1:7780/specials.html"
Write-Host "cloud desk: http://127.0.0.1:17777/   specials: http://127.0.0.1:7780/specials.html"

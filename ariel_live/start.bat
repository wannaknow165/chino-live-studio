@echo off
cd /d "%~dp0"
title ARIEL LIVE
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --new-window http://localhost:7777/
"C:\Program Files\nodejs\node.exe" server.mjs
pause

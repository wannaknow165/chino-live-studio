@echo off
cd /d "%~dp0"
title CHINO 3D CAMERA
py -3.13 tools/vcam.py --title "CHINO 3D STAGE" --url "http://localhost:7778/stage?vcam=1" --profile "%CD%/data/chrome_performer"
pause

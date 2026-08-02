@echo off
title Sparks
cd /d "%~dp0"
start /min "Sparks server" python -m http.server 8321 --directory "%~dp0"
timeout /t 1 >nul
start "" http://localhost:8321

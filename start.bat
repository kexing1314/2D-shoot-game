@echo off
cd /d %~dp0
title 2D Shooter Game Server
echo ==================================================
echo   LAN IP -- friends open  http://IP:3000
echo ==================================================
ipconfig | findstr IPv4
echo.
echo Local test:  http://localhost:3000
echo Close this window = stop server
echo.
node server.js
pause

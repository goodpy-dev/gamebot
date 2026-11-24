@echo off
chcp 65001 >nul
REM 겜잘알봇 실행 (윈도우) - 더블클릭
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 가 필요해요: https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요. & pause & exit /b 1)
if not exist node_modules call npm install --silent
start "" http://localhost:9251
node server.js
pause

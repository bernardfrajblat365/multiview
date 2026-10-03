@echo off
chcp 65001 >nul
title Quadra - preparando versao atual
cd /d "D:\Bernard\projetos\multiview\multiview"
set "ELECTRON_RENDERER_URL="
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\.bin\electron.cmd" (
  echo As dependencias do Quadra nao estao instaladas.
  echo Execute npm install nesta pasta e tente novamente.
  pause
  exit /b 1
)

echo Preparando a versao mais recente do Quadra...
call npm run build
if errorlevel 1 (
  echo.
  echo Nao foi possivel compilar o Quadra. Veja o erro acima.
  pause
  exit /b 1
)

echo Abrindo o Quadra...
call "node_modules\.bin\electron.cmd" .

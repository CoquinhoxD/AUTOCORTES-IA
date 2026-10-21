@echo off
setlocal EnableExtensions
title AutoCortes IA - Inicializador
cd /d "%~dp0"
echo ========================================
echo       AUTOCORTES IA - INICIAR APP
echo ========================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale Node.js 20 ou superior.
  goto :fail
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado. Reinstale Node.js.
  goto :fail
)
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo [ERRO] FFmpeg nao encontrado no PATH.
  goto :fail
)
where ffprobe >nul 2>&1
if errorlevel 1 (
  echo [ERRO] FFprobe nao encontrado no PATH.
  goto :fail
)
if not exist "backend\.env" (
  if not exist "backend\.env.example" (
    echo [ERRO] backend\.env.example ausente.
    goto :fail
  )
  copy /Y "backend\.env.example" "backend\.env" >nul
  echo [AVISO] backend\.env criado. Configure suas chaves de IA antes de analisar videos.
)
if not exist "node_modules\concurrently\package.json" (
  echo [INSTALANDO] Dependencias da raiz...
  call npm.cmd install
  if errorlevel 1 goto :fail
)
if not exist "backend\node_modules\tsx\package.json" (
  echo [INSTALANDO] Dependencias do backend...
  call npm.cmd install --prefix backend
  if errorlevel 1 goto :fail
)
if not exist "frontend\node_modules\vite\package.json" (
  echo [INSTALANDO] Dependencias do frontend...
  call npm.cmd install --prefix frontend
  if errorlevel 1 goto :fail
)
if not exist "backend\node_modules\.prisma\client\index.js" (
  echo [PREPARANDO] Banco SQLite e Prisma...
  call npm.cmd run prisma:setup
  if errorlevel 1 goto :fail
)
echo.
echo [OK] A interface sera aberta em http://localhost:5173
echo [INFO] Deixe esta janela aberta enquanto utilizar o app.
echo [INFO] Para encerrar, pressione CTRL+C nesta janela.
echo.
start "" "http://localhost:5173"
call npm.cmd run dev
if errorlevel 1 goto :fail
exit /b 0
:fail
echo.
echo [FALHA] Inicializacao interrompida. Confira a mensagem acima.
pause
exit /b 1

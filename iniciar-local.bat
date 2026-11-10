@echo off
setlocal
chcp 65001 >nul
rem Inicia el panel en modo desarrollo, visible solo desde este equipo.
cd /d "%~dp0"

rem Next lee las llaves de .env.local o de .env; sin ninguno, el panel no arranca.
if not exist ".env.local" if not exist ".env" (
  echo Falta el archivo de variables. Copia .env.example como .env.local o .env y completa las llaves.
  echo Detalle en docs\puesta-en-marcha.md
  pause
  exit /b 1
)

rem Usa pnpm si está instalado; si no, el que trae Node mediante corepack.
set "PNPM=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo No se encontró pnpm ni corepack. Instala pnpm: https://pnpm.io/installation
    pause
    exit /b 1
  )
  set "PNPM=corepack pnpm"
)

rem Deja las dependencias al día con pnpm-lock.yaml, por si alguien cambió algo en git.
call %PNPM% install --frozen-lockfile
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Panel en http://localhost:3000  (Ctrl+C para detener)
echo.
call %PNPM% dev

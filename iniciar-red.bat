@echo off
setlocal
chcp 65001 >nul
rem Inicia el panel en modo desarrollo, accesible desde otros dispositivos de la misma red.
rem Úsalo solo en redes de confianza: cualquiera en la red puede llegar a la pantalla de login.
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

rem IP de este equipo en la red local: la del adaptador activo que tiene puerta de enlace.
set "IP_LAN="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"`) do set "IP_LAN=%%i"
if not defined IP_LAN (
  echo No se encontró una conexión de red activa. Conéctate a la red y vuelve a intentar.
  pause
  exit /b 1
)

call %PNPM% install --frozen-lockfile
if errorlevel 1 (
  pause
  exit /b 1
)

rem next.config.ts lee esta variable para aceptar peticiones de desarrollo desde esa IP.
set "ORIGENES_DEV=%IP_LAN%"

echo.
echo Panel en este equipo:      http://localhost:3000
echo Panel desde otro equipo:   http://%IP_LAN%:3000
echo.
echo La primera vez Windows pregunta si Node.js puede usar la red: permite solo redes privadas.
echo Si el otro dispositivo no conecta, revisa que esta red esté marcada como privada en Windows.
echo Ctrl+C para detener.
echo.
call %PNPM% dev:red

@echo off
:: HATS setup script for Windows — run once on a new machine.
setlocal EnableDelayedExpansion

set "ROOT=%~dp0.."
pushd "%ROOT%"

echo.
echo === HATS setup ===
echo.

:: ── Node.js ──────────────────────────────────────────────────────────────────
echo -- Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] node not found. Install Node.js 20+ from https://nodejs.org
    goto :end_fail
)

for /f "tokens=*" %%v in ('node -e "process.stdout.write(String(process.versions.node.split('.')[0]))"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
    echo   [FAIL] Node.js %NODE_MAJOR% found — need 20+. Update at https://nodejs.org
    goto :end_fail
)

for /f "tokens=*" %%v in ('node --version') do echo   [OK]   Node.js %%v

:: ── npm install ───────────────────────────────────────────────────────────────
echo.
echo -- npm install
call npm install
if errorlevel 1 (
    echo   [FAIL] npm install failed
    goto :end_fail
)
echo   [OK]   dependencies installed

:: ── .env ─────────────────────────────────────────────────────────────────────
echo.
echo -- .env
if not exist "%ROOT%\.env" (
    copy "%ROOT%\.env.example" "%ROOT%\.env" >nul
    echo   [WARN] .env created from .env.example — fill in your API keys
) else (
    echo   [OK]   .env already exists
)

:: Warn about unfilled placeholder keys
findstr /r "=your_.*_here" "%ROOT%\.env" >nul 2>&1
if not errorlevel 1 (
    echo   [WARN] These keys still have placeholder values in .env:
    for /f "tokens=1 delims==" %%k in ('findstr /r "=your_.*_here" "%ROOT%\.env"') do (
        echo   [WARN]   %%k
    )
)

:: ── Piper TTS binary ──────────────────────────────────────────────────────────
echo.
echo -- Piper TTS (optional — required for avatar speech)
if exist "%ROOT%\piper\piper.exe" (
    echo   [OK]   piper\piper.exe found
) else (
    echo   [WARN] piper\piper.exe not found — avatar speech will be disabled
    echo   [WARN]   Download from https://github.com/rhasspy/piper/releases
    echo   [WARN]   and extract to %ROOT%\piper\
)

:: ── Piper voices ──────────────────────────────────────────────────────────────
set "VOICES_DIR=%ROOT%\piper_voices"
if defined PIPER_VOICES_DIR set "VOICES_DIR=%PIPER_VOICES_DIR%"

if exist "%VOICES_DIR%\" (
    set VOICE_COUNT=0
    for %%f in ("%VOICES_DIR%\*.onnx") do set /a VOICE_COUNT+=1
    if !VOICE_COUNT! GTR 0 (
        echo   [OK]   !VOICE_COUNT! voice model(s) found in %VOICES_DIR%
    ) else (
        echo   [WARN] No .onnx voice models in %VOICES_DIR%
        echo   [WARN]   Download from https://rhasspy.github.io/piper-samples/
    )
) else (
    echo   [WARN] Piper voices directory not found: %VOICES_DIR%
    echo   [WARN]   Create it and download .onnx voices from https://rhasspy.github.io/piper-samples/
)

:: ── Rhubarb ───────────────────────────────────────────────────────────────────
echo.
echo -- Rhubarb lip sync (optional — required for avatar lip sync)
set "RHUBARB_PATH=%ROOT%\rhubarb\rhubarb.exe"
if defined RHUBARB_BIN set "RHUBARB_PATH=%ROOT%\%RHUBARB_BIN%"

if exist "%RHUBARB_PATH%" (
    echo   [OK]   rhubarb found at %RHUBARB_PATH%
) else (
    where rhubarb >nul 2>&1
    if not errorlevel 1 (
        echo   [OK]   rhubarb found in PATH
    ) else (
        echo   [WARN] rhubarb not found — lip sync will be disabled
        echo   [WARN]   Download from https://github.com/DanielSWolf/rhubarb-lip-sync/releases
        echo   [WARN]   and place rhubarb.exe at %ROOT%\rhubarb\rhubarb.exe
    )
)

:: ── Summary ───────────────────────────────────────────────────────────────────
echo.
echo === Done ===
echo.
echo Run the app:  npm start
echo Web UI at:    http://localhost:3001
echo.
popd
endlocal
exit /b 0

:end_fail
popd
endlocal
exit /b 1

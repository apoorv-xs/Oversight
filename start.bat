@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

:: Check for virtual environment in project root and activate it
if exist "venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "venv\Scripts\activate.bat"
)

echo ============================================================
echo   OVERSIGHT - Adaptive Threat Engine
echo   Building frontend + starting server
echo ============================================================
echo.

:: ─── Check Python ────────────────────────────────────────────────
set PYTHON_CMD=python
where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=py
) else (
    python --version >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [FAIL] Python not found. Install Python 3.10+ and try again.
        pause
        exit /b 1
    )
)

:: ─── Check Node.js ────────────────────────────────────────────────
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [FAIL] Node.js not found. Install Node.js 18+ and try again.
    pause
    exit /b 1
)

:: ─── Install npm dependencies if missing ──────────────────────────
if not exist "frontend_v2\node_modules" (
    echo [....] Installing frontend dependencies...
    cd frontend_v2
    npm install
    if !ERRORLEVEL! neq 0 (
        echo [FAIL] npm install failed.
        pause
        exit /b 1
    )
    cd ..
    echo [ OK ] Dependencies installed.
) else (
    echo [ OK ] Frontend dependencies found.
)
echo.

:: ─── Build frontend with Vite ─────────────────────────────────────
echo [....] Building frontend...
cd frontend_v2
npx vite build >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [FAIL] Vite build failed. Run: cd frontend_v2 ^& npx vite build
    pause
    exit /b 1
)
cd ..
echo [ OK ] Frontend built successfully.
echo.

:: ─── Start Flask server ───────────────────────────────────────────
echo [....] Starting server...
echo.
echo Access the dashboard at: http://localhost:5000
echo.
echo [NOTE] Run as Administrator for packet capture features.
echo.
echo ============================================================
echo.

%PYTHON_CMD% run.py

echo.
echo Server stopped.
pause

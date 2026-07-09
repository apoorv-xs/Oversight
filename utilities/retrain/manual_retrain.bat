@echo off
cd /d "%~dp0"
echo ============================================================
echo Starting Manual AI Retraining...
echo ============================================================

:: Check for virtual environment in project root and activate it
if exist "..\..\venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "..\..\venv\Scripts\activate.bat"
)

:: Use py launcher if available, fallback to python
where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=py
) else (
    set PYTHON_CMD=python
)

%PYTHON_CMD% manual_retrain.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] Script execution failed.
    pause
)


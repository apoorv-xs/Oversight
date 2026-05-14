@echo off
cd /d "%~dp0"
echo ============================================================
echo OVERSIGHT: Adaptive Threat Engine
echo ============================================================
echo.
echo Initializing server...
echo Access the dashboard at: http://localhost:5000
echo.
echo [IMPORTANT] Run as Administrator for AI packet capture features
echo.
echo ============================================================
python run.py
pause

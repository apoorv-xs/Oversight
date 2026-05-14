@echo off
cd /d "%~dp0"
echo ============================================================
echo Starting Model Accuracy Evaluator...
echo ============================================================
python evaluate_model.py

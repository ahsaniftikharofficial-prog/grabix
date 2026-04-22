@echo off
cd /d "H:\Code\Project 3\grabix\backend"
python -m pytest tests/test_canary.py tests/test_features.py -v
pause
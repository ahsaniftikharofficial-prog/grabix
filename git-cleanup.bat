@echo off
REM ============================================================
REM  GRABIX — git-cleanup.bat
REM  Run this ONCE from your project root to untrack files that
REM  are already committed but should be ignored.
REM
REM  Steps:
REM  1. Replace your .gitignore with the new one first
REM  2. Then run this script
REM  3. Then do: git commit -m "chore: remove tracked junk files"
REM  4. Then push — GitHub will drop the bloat
REM ============================================================

echo [GRABIX Cleanup] Removing tracked files that should be ignored...
echo.

REM ─── Databases ───────────────────────────────────────────
git rm --cached memory.db 2>nul && echo Removed: memory.db

REM ─── Log files ───────────────────────────────────────────
git rm --cached backend/logs/launcher-backend.log 2>nul && echo Removed: backend/logs/launcher-backend.log
git rm --cached backend/logs/launcher-consumet.log 2>nul && echo Removed: backend/logs/launcher-consumet.log
git rm --cached backend/logs/launcher-frontend.log 2>nul && echo Removed: backend/logs/launcher-frontend.log
git rm --cached consumet-local/server-watch.log 2>nul && echo Removed: consumet-local/server-watch.log
git rm --cached consumet-local/server-watch.err.log 2>nul && echo Removed: consumet-local/server-watch.err.log

REM ─── Generated output files ──────────────────────────────
git rm --cached repomix-output.xml 2>nul && echo Removed: repomix-output.xml
git rm --cached src-only.xml 2>nul && echo Removed: src-only.xml
git rm --cached release-gate-report.json 2>nul && echo Removed: release-gate-report.json

REM ─── Temporary test folders ──────────────────────────────
git rm -r --cached .tmp-aniwatch-test/ 2>nul && echo Removed: .tmp-aniwatch-test/
git rm -r --cached .tmp-consumet-inspect/ 2>nul && echo Removed: .tmp-consumet-inspect/
git rm -r --cached .tmp-test-consumet-runtime/ 2>nul && echo Removed: .tmp-test-consumet-runtime/

REM ─── node_modules (if accidentally tracked anywhere) ─────
git rm -r --cached node_modules/ 2>nul && echo Removed: root node_modules/
git rm -r --cached grabix-ui/node_modules/ 2>nul && echo Removed: grabix-ui/node_modules/
git rm -r --cached consumet-local/node_modules/ 2>nul && echo Removed: consumet-local/node_modules/

REM ─── Python cache ────────────────────────────────────────
git rm -r --cached __pycache__/ 2>nul && echo Removed: __pycache__/
git rm -r --cached backend/__pycache__/ 2>nul && echo Removed: backend/__pycache__/

echo.
echo [DONE] Now run these two commands:
echo   git add .gitignore
echo   git commit -m "chore: remove tracked junk files and fix gitignore"
echo   git push
echo.
echo After pushing, your repo will be clean. Future pushes will stay small.
pause

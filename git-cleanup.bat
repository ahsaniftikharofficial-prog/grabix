@echo off
REM ============================================================
REM  GRABIX — git-cleanup.bat
REM  Updated for Phase 1 + Phase 2 refactor.
REM
REM  Steps:
REM  1. Run this script from the project root
REM  2. git add -A
REM  3. git commit -m "refactor: Phase 1+2 complete"
REM  4. git push
REM ============================================================

echo [GRABIX Cleanup] Removing tracked files...
echo.

REM ─── Phase 1: dead frontend files ────────────────────────
REM AnimePageV2.tsx — 742-line debug bypass page, removed from routing in App.tsx
git rm --cached grabix-ui/src/pages/AnimePageV2.tsx 2>nul && echo Removed: AnimePageV2.tsx

REM supabase.ts — cloud auth stub that never ran in this local desktop app
git rm --cached grabix-ui/src/lib/supabase.ts 2>nul && echo Removed: supabase.ts

REM ─── Phase 2: route_registry.py — DELETED ────────────────
REM The circular import it worked around is gone:
REM   downloads.py used to call main.py functions via the registry.
REM   downloads/engine.py is now a standalone module; downloads.py
REM   imports from it directly. route_registry.py is no longer needed.
git rm --cached backend/app/services/route_registry.py 2>nul && echo Removed: route_registry.py

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
echo ════════════════════════════════════════════════════════
echo  PHASE 1 + 2 CHANGES SUMMARY
echo ════════════════════════════════════════════════════════
echo.
echo  DELETED FILES:
echo    grabix-ui/src/pages/AnimePageV2.tsx          (742-line debug page)
echo    grabix-ui/src/lib/supabase.ts                (cloud auth in local app)
echo    backend/app/services/route_registry.py       (circular import hack)
echo.
echo  MODIFIED FILES:
echo    grabix-ui/src/App.tsx                        (2 dead imports removed)
echo    grabix-ui/src/pages/DownloaderPage.tsx       (1s polling replaced with SSE)
echo    backend/main.py                              (7935 -> 1804 lines)
echo    backend/app/routes/downloads.py              (registry -> direct import + SSE)
echo    backend/app/routes/streaming.py              (registry -> direct import)
echo.
echo  NEW FILES:
echo    backend/core/__init__.py
echo    backend/core/cache.py                        (unified SQLite cache)
echo    backend/core/state.py                        (typed DownloadJob dataclass)
echo    backend/core/utils.py                        (shared format helpers)
echo    backend/core/circuit_breaker.py              (single CB implementation)
echo    backend/moviebox/__init__.py
echo    backend/moviebox/routes.py                   (1287 lines from main.py)
echo    backend/anime/__init__.py
echo    backend/anime/resolver.py                    (536 lines from main.py)
echo    backend/downloads/__init__.py
echo    backend/downloads/engine.py                  (4609 lines from main.py)
echo.
echo  To commit:
echo    git add -A
echo    git commit -m "refactor: Phase 1+2 complete — main.py 7935->1804 lines"
echo    git push
echo.
pause

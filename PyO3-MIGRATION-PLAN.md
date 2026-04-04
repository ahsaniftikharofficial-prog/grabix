# GRABIX - PyO3 Embed Migration Plan
## Historical Reference

This file is retained as migration history only.

The authoritative release path is now:
- `scripts/setup-python-runtime.ps1`
- `build-installer.ps1`
- `verify-release.ps1`

Do not use this file as the current packaging guide.

## What Changed

Before:
- `grabix.exe` spawned `grabix-backend.exe` as a separate Python child process.

After:
- Python runs inside `grabix-ui.exe` via PyO3.
- The backend is staged fresh from `backend/`.
- The bundled HiAnime gateway is staged fresh from `consumet-local/`.
- The packaged build is smoke-tested before the installer is accepted.

## Current Build Sequence

1. `scripts/setup-python-runtime.ps1`
   - prepares `grabix-ui/src-tauri/python-runtime/`

2. `build-installer.ps1`
   - stages `backend/` into `grabix-ui/src-tauri/backend-staging/backend/`
   - stages `consumet-local/` into `grabix-ui/src-tauri/consumet-staging/consumet-local/`
   - stages a bundled Node runtime into `grabix-ui/src-tauri/consumet-staging/node-runtime/`
   - sets PyO3 build env
   - runs `npm run tauri build`
   - smoke-tests packaged backend + consumet + diagnostics

3. `verify-release.ps1`
   - validates packaged resources
   - runs backend tests
   - runs frontend build
   - runs `cargo check` with the bundled Python runtime
   - scans frontend source/assets for leaked TMDB secrets

## Current Runtime Architecture

`grabix-ui.exe` starts:
- Tauri/React frontend
- embedded PyO3 backend on `127.0.0.1:8000`
- bundled consumet gateway on the packaged consumet port

The desktop shell also initializes:
- packaged startup diagnostics
- backend resource identity (`build_id`, `backend_resource_hash`)
- desktop-to-backend local auth for sensitive routes
- app-state storage under local app data

## Notes

- `backend/` is the source of truth for packaged backend resources.
- `src-tauri/backend-staging/` and `src-tauri/consumet-staging/` are generated staging outputs, not hand-maintained source directories.
- If this document disagrees with `build-installer.ps1`, trust `build-installer.ps1`.

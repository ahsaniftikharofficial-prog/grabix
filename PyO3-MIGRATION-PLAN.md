# GRABIX — PyO3 Embed Migration Plan
## Goal: Single compiled exe. Crash structurally impossible.

---

## What Changes and Why

**Before:** `grabix.exe` spawns `grabix-backend.exe` (Python child process). If Python dies → crash banner.
**After:** Python interpreter lives INSIDE `grabix.exe` via PyO3. No child process. Backend cannot die independently.

---

## File Change Map

| File | Change |
|------|--------|
| `backend/main.py` | Add `run_server()` function — PyO3 calls this |
| `grabix-ui/src-tauri/Cargo.toml` | Add `pyo3 = "0.22"` dependency |
| `grabix-ui/src-tauri/build.rs` | Add PyO3 env rerun triggers |
| `grabix-ui/src-tauri/src/lib.rs` | Replace sidecar spawn with PyO3 embed |
| `grabix-ui/src-tauri/tauri.conf.json` | Bundle `python-runtime/` and `backend/` as resources |
| `scripts/setup-python-runtime.ps1` | NEW — downloads python-build-standalone, installs packages |
| `build-installer.ps1` | Replace PyInstaller step with python-runtime setup |

---

## Build Sequence (New)

```
1. scripts/setup-python-runtime.ps1
   → Downloads cpython-3.11 standalone for Windows x64
   → Installs all pip packages into it
   → Outputs: grabix-ui/src-tauri/python-runtime/

2. Copy backend/ → grabix-ui/src-tauri/backend/

3. Set PYO3_PYTHON = grabix-ui/src-tauri/python-runtime/python.exe

4. npm run tauri build
   → Cargo links against python311.dll from python-runtime/
   → Tauri bundles python-runtime/ and backend/ as resources
   → Output: single grabix.exe (well, installer) with Python embedded
```

---

## Runtime Architecture (New)

```
grabix.exe starts
   │
   ├─ Rust/Tauri UI thread (React frontend)
   │
   └─ PyO3 thread (Rust-managed)
        │
        ├─ Sets PYTHONHOME = resources/python-runtime/
        ├─ Sets PYTHONPATH = resources/backend/
        ├─ pyo3::prepare_freethreaded_python()
        ├─ Python::with_gil → import main → main.run_server()
        └─ uvicorn runs on 127.0.0.1:8000 (same as before)
```

React frontend still calls `localhost:8000` — zero frontend changes needed.

---

## Phases

- [x] Phase 0 — Read and understand full codebase
- [ ] Phase 1 — Python side: add run_server() to main.py
- [ ] Phase 2 — Rust side: Cargo.toml + build.rs + lib.rs
- [ ] Phase 3 — Build scripts: setup-python-runtime.ps1 + build-installer.ps1
- [ ] Phase 4 — Tauri config: bundle resources

---

## SESSION RESUME CONTEXT (10 lines for next Claude if limit hit)
1. Project: GRABIX — Tauri 2 desktop app, Rust+React frontend, Python FastAPI backend
2. Goal: PyO3 embed so Python runs INSIDE grabix.exe — no child process, crash impossible
3. Files done: PyO3-MIGRATION-PLAN.md created (this file)
4. NEXT: Modify backend/main.py — add run_server() callable at bottom of file
5. NEXT: Modify grabix-ui/src-tauri/Cargo.toml — add pyo3 = { version = "0.22" }
6. NEXT: Modify grabix-ui/src-tauri/build.rs — add PyO3 env rerun triggers
7. NEXT: Replace grabix-ui/src-tauri/src/lib.rs — PyO3 embed replaces sidecar spawn
8. NEXT: Create scripts/setup-python-runtime.ps1 — downloads cpython-3.11 standalone
9. NEXT: Update build-installer.ps1 — remove PyInstaller, add python-runtime setup step
10. NEXT: Update tauri.conf.json resources to include python-runtime/** and backend/**

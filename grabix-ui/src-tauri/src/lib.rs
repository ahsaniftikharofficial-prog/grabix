// ─────────────────────────────────────────────────────────────────────────────
// GRABIX — lib.rs (PyO3 embedded backend edition)
//
// Architecture change: Python is no longer a child process.
// PyO3 embeds the Python interpreter INSIDE this Rust binary.
// The FastAPI/uvicorn server runs on a Rust-managed thread.
// If the app is running, the backend is running. Crash is structurally impossible.
// ─────────────────────────────────────────────────────────────────────────────

use std::{
    fs::{create_dir_all, OpenOptions},
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use pyo3::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ── Startup state (read by React via get_startup_diagnostics) ─────────────────

struct StartupState {
    snapshot: Mutex<StartupDiagnostics>,
}

#[derive(Clone, Serialize, Default)]
struct SidecarDiagnostic {
    name: String,
    status: String,
    message: String,
    port: u16,
    binary_path: String,
}

#[derive(Clone, Serialize, Default)]
struct StartupDiagnostics {
    app_mode: String,
    startup_ready: bool,
    log_path: String,
    diagnostics_path: String,
    resource_dir: String,
    backend: SidecarDiagnostic,
    consumet: SidecarDiagnostic,
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_startup_diagnostics(state: State<'_, StartupState>) -> StartupDiagnostics {
    state.snapshot.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
fn open_startup_log(state: State<'_, StartupState>) -> Result<String, String> {
    let snapshot = state
        .snapshot
        .lock()
        .map_err(|_| String::from("Could not read startup diagnostics."))?
        .clone();

    if snapshot.log_path.is_empty() {
        return Err(String::from("Startup log path is unavailable."));
    }

    let log_path = PathBuf::from(&snapshot.log_path);
    let target = if log_path.exists() {
        log_path
    } else {
        log_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| String::from("Startup log folder could not be resolved."))?
    };

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        if target.is_file() {
            command.arg("/select,").arg(&target);
        } else {
            command.arg(&target);
        }
        command.creation_flags(0x08000000);
        command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(target.display().to_string());
    }

    #[allow(unreachable_code)]
    Err(String::from(
        "Opening the startup log is currently implemented for Windows only.",
    ))
}

// ── Diagnostics helpers ───────────────────────────────────────────────────────

fn diagnostics_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_local_data_dir() {
        return dir.join("diagnostics");
    }
    std::env::temp_dir().join("grabix-diagnostics")
}

fn diagnostics_log_path(app: &AppHandle) -> PathBuf {
    diagnostics_dir(app).join("sidecar-startup.log")
}

fn diagnostics_json_path(app: &AppHandle) -> PathBuf {
    diagnostics_dir(app).join("startup-diagnostics.json")
}

fn write_diagnostics_snapshot(app: &AppHandle, diagnostics: &StartupDiagnostics) {
    let dir = diagnostics_dir(app);
    let _ = create_dir_all(&dir);
    let path = diagnostics_json_path(app);
    if let Ok(payload) = serde_json::to_string_pretty(diagnostics) {
        let _ = std::fs::write(path, payload);
    }
}

fn log_sidecar(app: &AppHandle, message: &str) {
    let dir = diagnostics_dir(app);
    let _ = create_dir_all(&dir);
    let log_path = diagnostics_log_path(app);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let payload = serde_json::json!({
            "timestamp": chrono_stamp(),
            "level": "INFO",
            "service": "desktop-shell",
            "event": "startup",
            "correlation_id": "",
            "message": message,
            "details": {}
        });
        let _ = writeln!(file, "{}", payload);
    }
}

fn chrono_stamp() -> String {
    let now = std::time::SystemTime::now();
    match now.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => format!("{}", d.as_secs()),
        Err(_) => String::from("0"),
    }
}

// ── Network helper ────────────────────────────────────────────────────────────

fn wait_for_http_ok(port: u16, path: &str, timeout_secs: u64) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(timeout_secs) {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(1200)));
            let request = format!(
                "GET {} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
                path
            );
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut response = String::new();
                let _ = stream.read_to_string(&mut response);
                if response.starts_with("HTTP/1.1 200")
                    || response.starts_with("HTTP/1.0 200")
                    || response.starts_with("HTTP/1.1 204")
                    || response.starts_with("HTTP/1.0 204")
                {
                    return true;
                }
            }
        }
        thread::sleep(Duration::from_millis(450));
    }
    false
}

// ── PyO3 runtime location helpers ─────────────────────────────────────────────

fn find_python_home(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("python-runtime"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join("python-runtime"));
            candidates.push(exe_dir.join("python-runtime"));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

fn find_backend_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("backend"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join("backend"));
            candidates.push(exe_dir.join("backend"));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

// ── Windows DLL loader fix ────────────────────────────────────────────────────
// python311.dll is delay-loaded (see .cargo/config.toml) so the OS does NOT
// attempt to find it at process startup. We call this BEFORE prepare_freethreaded_python()
// so Windows knows exactly where to look when it does load the DLL.
// This is the permanent fix — no DLL copying, no PATH hacks, no installer tricks.
#[cfg(target_os = "windows")]
fn set_python_dll_directory(python_home: &PathBuf) {
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
    }
    let wide: Vec<u16> = python_home
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0u16))
        .collect();
    let result = unsafe { SetDllDirectoryW(wide.as_ptr()) };
    if result == 0 {
        eprintln!("WARNING: SetDllDirectoryW failed for {:?}", python_home);
    }
}

// ── PyO3 backend startup ──────────────────────────────────────────────────────

fn start_python_backend(app: AppHandle, python_home: PathBuf, backend_dir: PathBuf) {
    thread::Builder::new()
        .name(String::from("pyo3-backend"))
        .spawn(move || {
            log_sidecar(
                &app,
                &format!(
                    "PyO3: Initializing embedded Python. PYTHONHOME={} BACKEND={}",
                    python_home.display(),
                    backend_dir.display()
                ),
            );

            // WINDOWS: Tell the OS exactly where python311.dll lives BEFORE any
            // PyO3 call. python311.dll is delay-loaded (see .cargo/config.toml),
            // meaning the OS does NOT load it at process startup. The first call
            // to prepare_freethreaded_python() below triggers the load — by that
            // point SetDllDirectoryW has already pointed Windows at python-runtime/.
            // This is the permanent fix: no copying, no PATH hacks.
            #[cfg(target_os = "windows")]
            set_python_dll_directory(&python_home);

            // CRITICAL: Set PYTHONHOME before interpreter initializes.
            // PYTHONHOME tells Python where its stdlib and site-packages live.
            // PYTHONPATH adds our backend/ source directory to the import path.
            std::env::set_var("PYTHONHOME", &python_home);
            std::env::set_var("PYTHONPATH", backend_dir.to_str().unwrap_or(""));
            std::env::set_var("PYTHONDONTWRITEBYTECODE", "1");
            std::env::set_var("PYTHONUNBUFFERED", "1");

            // Initialize Python interpreter (must happen before with_gil).
            pyo3::prepare_freethreaded_python();

            let result = Python::with_gil(|py| -> PyResult<()> {
                // Put backend_dir at front of sys.path so `import main` works.
                let sys = py.import_bound("sys")?;
                let path = sys.getattr("path")?;
                path.call_method1("insert", (0, backend_dir.to_str().unwrap_or("")))?;

                log_sidecar(&app, "PyO3: Importing backend main module...");
                let main_mod = py.import_bound("main")?;

                log_sidecar(&app, "PyO3: Calling main.run_server() — uvicorn starting...");
                // run_server() blocks here forever (uvicorn event loop).
                // When the Rust process exits, this thread exits, Python exits.
                main_mod.call_method0("run_server")?;

                Ok(())
            });

            match result {
                Ok(_) => log_sidecar(&app, "PyO3: Python backend exited cleanly."),
                Err(e) => log_sidecar(&app, &format!("PyO3: Python backend error: {}", e)),
            }
        })
        .expect("Failed to spawn pyo3-backend thread");
}

fn update_backend_status(app: &AppHandle, status: &str, message: &str, ready: bool) {
    if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
        snapshot.backend.status = status.to_string();
        snapshot.backend.message = message.to_string();
        snapshot.startup_ready = ready;
    }
}

fn start_python_backend_async(app: AppHandle) {
    thread::Builder::new()
        .name(String::from("pyo3-orchestrator"))
        .spawn(move || {
            let python_home = match find_python_home(&app) {
                Some(p) => p,
                None => {
                    let msg = "ERROR: python-runtime/ not found in app resources. Reinstall GRABIX.";
                    log_sidecar(&app, msg);
                    update_backend_status(&app, "missing", msg, false);
                    return;
                }
            };

            let backend_dir = match find_backend_dir(&app) {
                Some(p) => p,
                None => {
                    let msg = "ERROR: backend/ not found in app resources. Reinstall GRABIX.";
                    log_sidecar(&app, msg);
                    update_backend_status(&app, "missing", msg, false);
                    return;
                }
            };

            log_sidecar(
                &app,
                &format!(
                    "PyO3: Resources located. python_home={} backend={}",
                    python_home.display(),
                    backend_dir.display()
                ),
            );

            update_backend_status(&app, "starting", "Embedded Python backend initializing...", false);

            start_python_backend(app.clone(), python_home, backend_dir);

            // Give Python a moment to spin up before polling.
            thread::sleep(Duration::from_secs(2));

            log_sidecar(&app, "PyO3: Waiting for uvicorn on port 8000 (timeout: 60s)...");

            if wait_for_http_ok(8000, "/health/ping", 60) {
                let msg = "Embedded Python backend is healthy on port 8000.";
                log_sidecar(&app, &format!("PyO3: {}", msg));
                update_backend_status(&app, "started", msg, true);
            } else {
                let msg = "Backend did not respond within 60s. Check startup log for Python import errors.";
                log_sidecar(&app, &format!("PyO3: TIMEOUT — {}", msg));
                update_backend_status(&app, "timeout", msg, false);
            }

            let snapshot = app
                .state::<StartupState>()
                .snapshot
                .lock()
                .map(|s| s.clone())
                .unwrap_or_default();
            write_diagnostics_snapshot(&app, &snapshot);
        })
        .expect("Failed to spawn pyo3-orchestrator thread");
}

// ── Initial diagnostics ───────────────────────────────────────────────────────

fn initial_diagnostics(app: &AppHandle) -> StartupDiagnostics {
    let resource_dir = app
        .path()
        .resource_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    StartupDiagnostics {
        app_mode: if cfg!(debug_assertions) {
            String::from("development")
        } else {
            String::from("production")
        },
        startup_ready: cfg!(debug_assertions),
        log_path: diagnostics_log_path(app).display().to_string(),
        diagnostics_path: diagnostics_json_path(app).display().to_string(),
        resource_dir,
        backend: SidecarDiagnostic {
            name: String::from("backend"),
            status: if cfg!(debug_assertions) {
                String::from("development")
            } else {
                String::from("starting")
            },
            message: if cfg!(debug_assertions) {
                String::from("Debug mode — run backend manually: python backend/main.py")
            } else {
                String::from("Embedded Python backend initializing via PyO3...")
            },
            port: 8000,
            binary_path: String::from("(embedded via PyO3 — no separate process)"),
        },
        consumet: SidecarDiagnostic {
            name: String::from("consumet"),
            status: String::from("internal"),
            message: String::from(
                "Anime provider logic is handled inside the embedded Python backend.",
            ),
            port: 0,
            binary_path: String::new(),
        },
    }
}

// ── Tauri app entry point ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(StartupState {
            snapshot: Mutex::new(StartupDiagnostics::default()),
        })
        .setup(|app| {
            let initial = initial_diagnostics(app.handle());
            if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
                *snapshot = initial.clone();
            }
            write_diagnostics_snapshot(app.handle(), &initial);
            log_sidecar(app.handle(), "GRABIX started (PyO3 embedded backend edition).");

            if !cfg!(debug_assertions) {
                start_python_backend_async(app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_clipboard_text,
            get_startup_diagnostics,
            open_startup_log
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // On exit: Python lives inside this process and dies automatically.
    // No child processes to kill — nothing to do here.
    app.run(|_app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            // PyO3 cleanup is automatic when the process exits.
        }
    });
}

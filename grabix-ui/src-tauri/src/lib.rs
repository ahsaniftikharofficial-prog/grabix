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
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use pyo3::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn build_id() -> &'static str {
    option_env!("GRABIX_BUILD_ID").unwrap_or("dev")
}

fn backend_resource_hash() -> &'static str {
    option_env!("GRABIX_BACKEND_RESOURCE_HASH").unwrap_or("")
}

fn backend_resource_subdir() -> &'static str {
    option_env!("GRABIX_BACKEND_RESOURCE_SUBDIR").unwrap_or("backend")
}

const PACKAGED_CONSUMET_PORT: u16 = 3100;

// ── Startup state (read by React via get_startup_diagnostics) ─────────────────

struct StartupState {
    snapshot: Mutex<StartupDiagnostics>,
}

struct SidecarProcessState {
    consumet_child: Mutex<Option<Child>>,
}

#[derive(Clone, Serialize, Default)]
struct SidecarDiagnostic {
    name: String,
    status: String,
    message: String,
    failure_code: String,
    port: u16,
    binary_path: String,
}

#[derive(Clone, Serialize, Default)]
struct StartupDiagnostics {
    app_mode: String,
    build_id: String,
    backend_resource_hash: String,
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

fn http_ok_once(port: u16, path: &str) -> bool {
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
            return response.starts_with("HTTP/1.1 200")
                || response.starts_with("HTTP/1.0 200")
                || response.starts_with("HTTP/1.1 204")
                || response.starts_with("HTTP/1.0 204");
        }
    }
    false
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_consumet_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("consumet-staging").join("consumet-local"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("consumet-staging")
                    .join("consumet-local"),
            );
            candidates.push(exe_dir.join("consumet-staging").join("consumet-local"));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

fn find_consumet_node(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("consumet-staging")
                .join("node-runtime")
                .join("node.exe"),
        );
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("consumet-staging")
                    .join("node-runtime")
                    .join("node.exe"),
            );
            candidates.push(
                exe_dir
                    .join("consumet-staging")
                    .join("node-runtime")
                    .join("node.exe"),
            );
        }
    }
    candidates.into_iter().find(|p| p.exists())
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
    let backend_candidates = [
        backend_resource_subdir(),
        "backend",
        "backend-staging/backend",
        "generated/backend",
    ];
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        for relative in backend_candidates {
            candidates.push(resource_dir.join(relative));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for relative in backend_candidates {
                candidates.push(exe_dir.join("resources").join(relative));
                candidates.push(exe_dir.join(relative));
            }
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

// ── Windows DLL loader fix ────────────────────────────────────────────────────
// python311.dll is hard-linked (no DELAYLOAD). Windows loads it at process
// startup from the exe directory (installer-hooks.nsh copies it there).
// We still call SetDllDirectoryW so Python can find its own extension DLLs
// (.pyd files) inside python-runtime/ at runtime.
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

            // WINDOWS: Tell the OS where Python's extension DLLs live.
            // python311.dll is already loaded at this point (hard-linked),
            // but SetDllDirectoryW ensures Python can load .pyd extension
            // modules from python-runtime/ at runtime.
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

                log_sidecar(
                    &app,
                    "PyO3: Calling main.run_server() — uvicorn starting...",
                );
                // run_server() blocks here forever (uvicorn event loop).
                // When the Rust process exits, this thread exits, Python exits.
                main_mod.call_method0("run_server")?;

                Ok(())
            });

            match result {
                Ok(_) => {
                    let msg = "Embedded Python backend exited before startup completed.";
                    log_sidecar(&app, "PyO3: Python backend exited cleanly.");
                    update_backend_status(&app, "failed", msg, false, "python_backend_exited");
                }
                Err(e) => {
                    let msg = format!("Embedded Python backend bootstrap failed: {}", e);
                    log_sidecar(&app, &format!("PyO3: Python backend error: {}", e));
                    update_backend_status(&app, "failed", &msg, false, "python_bootstrap_failed");
                }
            }
        })
        .expect("Failed to spawn pyo3-backend thread");
}

fn update_backend_status(
    app: &AppHandle,
    status: &str,
    message: &str,
    ready: bool,
    failure_code: &str,
) {
    if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
        snapshot.backend.status = status.to_string();
        snapshot.backend.message = message.to_string();
        snapshot.backend.failure_code = failure_code.to_string();
        snapshot.startup_ready = ready;
        let current = snapshot.clone();
        drop(snapshot);
        write_diagnostics_snapshot(app, &current);
    }
}

fn update_consumet_status(
    app: &AppHandle,
    status: &str,
    message: &str,
    failure_code: &str,
    port: u16,
    binary_path: &str,
) {
    if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
        snapshot.consumet.status = status.to_string();
        snapshot.consumet.message = message.to_string();
        snapshot.consumet.failure_code = failure_code.to_string();
        snapshot.consumet.port = port;
        snapshot.consumet.binary_path = binary_path.to_string();
        let current = snapshot.clone();
        drop(snapshot);
        write_diagnostics_snapshot(app, &current);
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum ConsumetLaunchState {
    Ready,
    Starting,
    Failed,
}

fn stop_consumet_sidecar(app: &AppHandle) {
    if let Ok(mut child_slot) = app.state::<SidecarProcessState>().consumet_child.lock() {
        if let Some(mut child) = child_slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn start_consumet_sidecar(app: &AppHandle) -> ConsumetLaunchState {
    let node_binary = match find_consumet_node(app) {
        Some(path) => path,
        None => {
            let msg = "Bundled HiAnime gateway runtime was not found in app resources.";
            log_sidecar(app, msg);
            update_consumet_status(
                app,
                "missing",
                msg,
                "consumet_runtime_missing",
                PACKAGED_CONSUMET_PORT,
                "",
            );
            return ConsumetLaunchState::Failed;
        }
    };

    let consumet_dir = match find_consumet_dir(app) {
        Some(path) => path,
        None => {
            let msg = "Bundled HiAnime gateway files were not found in app resources.";
            log_sidecar(app, msg);
            update_consumet_status(
                app,
                "missing",
                msg,
                "consumet_resource_missing",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Failed;
        }
    };

    if !is_port_available(PACKAGED_CONSUMET_PORT) {
        if http_ok_once(PACKAGED_CONSUMET_PORT, "/") {
            let msg = format!(
                "Reusing an existing HiAnime gateway on port {}.",
                PACKAGED_CONSUMET_PORT
            );
            log_sidecar(app, &format!("Consumet: {}", msg));
            update_consumet_status(
                app,
                "reused",
                &msg,
                "",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Ready;
        }

        let msg = format!(
            "Bundled HiAnime gateway port {} is already in use.",
            PACKAGED_CONSUMET_PORT
        );
        log_sidecar(app, &format!("Consumet: {}", msg));
        update_consumet_status(
            app,
            "port_in_use",
            &msg,
            "consumet_port_in_use",
            PACKAGED_CONSUMET_PORT,
            node_binary.to_string_lossy().as_ref(),
        );
        return ConsumetLaunchState::Failed;
    }

    let log_path = diagnostics_log_path(app);
    let stdout_log = match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(file) => file,
        Err(error) => {
            let msg = format!(
                "Could not open the startup log for the HiAnime gateway: {}",
                error
            );
            log_sidecar(app, &format!("Consumet: {}", msg));
            update_consumet_status(
                app,
                "failed",
                &msg,
                "consumet_log_open_failed",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Failed;
        }
    };
    let stderr_log = match stdout_log.try_clone() {
        Ok(file) => file,
        Err(error) => {
            let msg = format!(
                "Could not clone the startup log handle for the HiAnime gateway: {}",
                error
            );
            log_sidecar(app, &format!("Consumet: {}", msg));
            update_consumet_status(
                app,
                "failed",
                &msg,
                "consumet_log_clone_failed",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Failed;
        }
    };

    update_consumet_status(
        app,
        "starting",
        "Bundled HiAnime gateway initializing...",
        "",
        PACKAGED_CONSUMET_PORT,
        node_binary.to_string_lossy().as_ref(),
    );

    let mut command = Command::new(&node_binary);
    command
        .current_dir(&consumet_dir)
        .arg("server.cjs")
        .arg("--port")
        .arg(PACKAGED_CONSUMET_PORT.to_string())
        .arg("--site-base")
        .arg("https://aniwatchtv.to")
        .env("PORT", PACKAGED_CONSUMET_PORT.to_string())
        .env("HIANIME_SITE_BASE", "https://aniwatchtv.to")
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let msg = format!("Could not launch the bundled HiAnime gateway: {}", error);
            log_sidecar(app, &format!("Consumet: {}", msg));
            update_consumet_status(
                app,
                "failed",
                &msg,
                "consumet_spawn_failed",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Failed;
        }
    };

    if let Ok(mut child_slot) = app.state::<SidecarProcessState>().consumet_child.lock() {
        *child_slot = Some(child);
    }

    log_sidecar(
        app,
        &format!(
            "Consumet: launched bundled HiAnime gateway with {} from {}",
            node_binary.display(),
            consumet_dir.display()
        ),
    );

    let deadline = Instant::now() + Duration::from_secs(25);
    while Instant::now() < deadline {
        if http_ok_once(PACKAGED_CONSUMET_PORT, "/") {
            let msg = format!(
                "Bundled HiAnime gateway is healthy on port {}.",
                PACKAGED_CONSUMET_PORT
            );
            log_sidecar(app, &format!("Consumet: {}", msg));
            update_consumet_status(
                app,
                "started",
                &msg,
                "",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Ready;
        }

        let exited =
            if let Ok(mut child_slot) = app.state::<SidecarProcessState>().consumet_child.lock() {
                if let Some(child) = child_slot.as_mut() {
                    child.try_wait().ok().flatten()
                } else {
                    None
                }
            } else {
                None
            };

        if let Some(status) = exited {
            if let Ok(mut child_slot) = app.state::<SidecarProcessState>().consumet_child.lock() {
                *child_slot = None;
            }
            let msg = format!(
                "Bundled HiAnime gateway exited before startup completed (status: {}).",
                status
            );
            log_sidecar(app, &format!("Consumet: {}", msg));
            update_consumet_status(
                app,
                "failed",
                &msg,
                "consumet_exited_early",
                PACKAGED_CONSUMET_PORT,
                node_binary.to_string_lossy().as_ref(),
            );
            return ConsumetLaunchState::Failed;
        }

        thread::sleep(Duration::from_millis(350));
    }

    let msg = format!(
        "Bundled HiAnime gateway is still warming up on port {}. The backend will keep waiting on demand.",
        PACKAGED_CONSUMET_PORT
    );
    log_sidecar(app, &format!("Consumet: {}", msg));
    update_consumet_status(
        app,
        "starting",
        &msg,
        "consumet_start_timeout",
        PACKAGED_CONSUMET_PORT,
        node_binary.to_string_lossy().as_ref(),
    );
    ConsumetLaunchState::Starting
}

fn backend_terminal_failure(app: &AppHandle) -> Option<(String, String)> {
    app.state::<StartupState>()
        .snapshot
        .lock()
        .ok()
        .and_then(|snapshot| {
            let status = snapshot.backend.status.clone();
            if matches!(status.as_str(), "failed" | "missing" | "port_in_use") {
                Some((
                    snapshot.backend.failure_code.clone(),
                    snapshot.backend.message.clone(),
                ))
            } else {
                None
            }
        })
}

fn start_python_backend_async(app: AppHandle) {
    thread::Builder::new()
        .name(String::from("pyo3-orchestrator"))
        .spawn(move || {
            let consumet_state = start_consumet_sidecar(&app);
            match consumet_state {
                ConsumetLaunchState::Ready | ConsumetLaunchState::Starting => {
                    std::env::set_var(
                        "CONSUMET_API_BASE",
                        format!("http://127.0.0.1:{}", PACKAGED_CONSUMET_PORT),
                    );
                }
                ConsumetLaunchState::Failed => {
                    std::env::remove_var("CONSUMET_API_BASE");
                }
            }

            let python_home = match find_python_home(&app) {
                Some(p) => p,
                None => {
                    let msg = "ERROR: python-runtime/ not found. Run scripts/setup-python-runtime.ps1 then rebuild.";
                    log_sidecar(&app, msg);
                    update_backend_status(
                        &app,
                        "missing",
                        msg,
                        false,
                        "python_runtime_missing",
                    );
                    return;
                }
            };

            let backend_dir = match find_backend_dir(&app) {
                Some(p) => p,
                None => {
                    let msg = "ERROR: backend/ not found in app resources. Reinstall GRABIX.";
                    log_sidecar(&app, msg);
                    update_backend_status(
                        &app,
                        "missing",
                        msg,
                        false,
                        "backend_resource_missing",
                    );
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

            if !is_port_available(8000) {
                let msg = "Backend port 8000 is already in use. Close the other process and relaunch GRABIX.";
                log_sidecar(&app, &format!("PyO3: {}", msg));
                update_backend_status(&app, "port_in_use", msg, false, "port_in_use");
                return;
            }

            update_backend_status(
                &app,
                "starting",
                "Embedded Python backend initializing...",
                false,
                "",
            );

            start_python_backend(app.clone(), python_home, backend_dir);

            // Give Python a moment to spin up before polling.
            thread::sleep(Duration::from_secs(2));

            let timeout_secs = 90;
            let started = Instant::now();
            log_sidecar(
                &app,
                &format!(
                    "PyO3: Waiting for uvicorn on port 8000 (timeout: {}s)...",
                    timeout_secs
                ),
            );

            loop {
                if http_ok_once(8000, "/health/ping") {
                    let msg = "Embedded Python backend is healthy on port 8000.";
                    log_sidecar(&app, &format!("PyO3: {}", msg));
                    update_backend_status(&app, "started", msg, true, "");
                    break;
                }

                if let Some((failure_code, message)) = backend_terminal_failure(&app) {
                    log_sidecar(
                        &app,
                        &format!(
                            "PyO3: backend startup aborted early [{}] {}",
                            failure_code, message
                        ),
                    );
                    break;
                }

                if started.elapsed() >= Duration::from_secs(timeout_secs) {
                    let msg =
                        "Backend did not respond within 90s. Check startup log for embedded Python errors.";
                    log_sidecar(&app, &format!("PyO3: TIMEOUT - {}", msg));
                    update_backend_status(
                        &app,
                        "timeout",
                        msg,
                        false,
                        "backend_start_timeout",
                    );
                    break;
                }

                thread::sleep(Duration::from_millis(450));
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
        build_id: build_id().to_string(),
        backend_resource_hash: backend_resource_hash().to_string(),
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
            failure_code: String::new(),
            port: 8000,
            binary_path: String::from("(embedded via PyO3 - no separate process)"),
        },
        consumet: SidecarDiagnostic {
            name: String::from("consumet"),
            status: if cfg!(debug_assertions) {
                String::from("development")
            } else {
                String::from("starting")
            },
            message: if cfg!(debug_assertions) {
                String::from("run.bat provides the local Consumet sidecar in development.")
            } else {
                String::from("Bundled HiAnime gateway initializing for packaged mode...")
            },
            failure_code: String::new(),
            port: if cfg!(debug_assertions) {
                3000
            } else {
                PACKAGED_CONSUMET_PORT
            },
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
        .manage(SidecarProcessState {
            consumet_child: Mutex::new(None),
        })
        .setup(|app| {
            let initial = initial_diagnostics(app.handle());
            if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
                *snapshot = initial.clone();
            }
            write_diagnostics_snapshot(app.handle(), &initial);
            log_sidecar(
                app.handle(),
                &format!(
                    "GRABIX started (PyO3 embedded backend edition). build_id={} backend_hash={}",
                    build_id(),
                    backend_resource_hash()
                ),
            );

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

    // Python lives inside this process and dies automatically.
    // The bundled HiAnime gateway is a child process and must be stopped.
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_consumet_sidecar(&app_handle);
        }
    });
}

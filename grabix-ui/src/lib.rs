use std::{
    fs::{create_dir_all, OpenOptions},
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct SidecarState {
    children: Mutex<Vec<Child>>,
}

/// Holds the backend binary path so the watchdog can restart it without
/// re-scanning the filesystem on every recovery attempt.
struct WatchdogConfig {
    backend_binary: Mutex<Option<PathBuf>>,
}

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

struct StartupOutcome {
    children: Vec<Child>,
    diagnostics: StartupDiagnostics,
}

const SIDECAR_RESTART_COOLDOWN_MS: u64 = 1800;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.get_text().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_startup_diagnostics(state: State<'_, StartupState>) -> StartupDiagnostics {
    state
        .snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .unwrap_or_default()
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
            .map_err(|error| error.to_string())?;
        return Ok(target.display().to_string());
    }

    #[allow(unreachable_code)]
    Err(String::from(
        "Opening the startup log is currently implemented for Windows only.",
    ))
}

fn resource_bin(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("bin").join(file_name));
        if let Some(stem) = Path::new(file_name).file_stem() {
            candidates.push(
                resource_dir
                    .join("bin")
                    .join(stem)
                    .join(file_name),
            );
        }
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources").join("bin").join(file_name));
            if let Some(stem) = Path::new(file_name).file_stem() {
                candidates.push(
                    exe_dir
                        .join("resources")
                        .join("bin")
                        .join(stem)
                        .join(file_name),
                );
            }
            candidates.push(exe_dir.join("bin").join(file_name));
            candidates.push(exe_dir.join(file_name));
        }
    }

    candidates.into_iter().find(|candidate| candidate.exists())
}

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
        Ok(duration) => format!("{}", duration.as_secs()),
        Err(_) => String::from("0"),
    }
}

fn spawn_process(program: &Path, envs: &[(&str, &str)]) -> Result<Child, String> {
    let mut command = Command::new(program);
    if let Some(parent) = program.parent() {
        command.current_dir(parent);
    }
    command.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }
    for (key, value) in envs {
        command.env(key, value);
    }
    command.spawn().map_err(|error| error.to_string())
}

fn terminate_child_process(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        let _ = command
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .status();
    }

    let _ = child.kill();
}

fn sidecar_ready(port: u16, health_path: &str, timeout_secs: u64) -> bool {
    if !health_path.is_empty() && wait_for_http_ok(port, health_path, timeout_secs) {
        return true;
    }
    wait_for_port(port, timeout_secs)
}

fn try_launch_sidecar(
    app: &AppHandle,
    diagnostic: &SidecarDiagnostic,
    program: &Path,
    envs: &[(&str, &str)],
    health_path: &str,
    timeout_secs: u64,
) -> Result<Child, String> {
    match spawn_process(program, envs) {
        Ok(mut child) => {
            if sidecar_ready(diagnostic.port, health_path, timeout_secs) {
                Ok(child)
            } else {
                let _ = child.kill();
                Err(format!(
                    "{} sidecar did not become healthy in time.",
                    diagnostic.name
                ))
            }
        }
        Err(error) => {
            log_sidecar(
                app,
                &format!("{} sidecar launch failed: {}", diagnostic.name, error),
            );
            Err(format!(
                "{} sidecar could not be launched: {}",
                diagnostic.name, error
            ))
        }
    }
}

fn start_sidecar_with_supervision(
    app: &AppHandle,
    diagnostic: &mut SidecarDiagnostic,
    program: &Path,
    envs: &[(&str, &str)],
    health_path: &str,
    timeout_secs: u64,
    success_message: &str,
) -> Option<Child> {
    let mut last_error = String::new();

    for attempt in 0..=1 {
        if attempt == 1 {
            diagnostic.status = String::from("recovering");
            diagnostic.message = format!(
                "{} did not start cleanly. Retrying once after cooldown.",
                diagnostic.name
            );
            log_sidecar(app, &diagnostic.message);
            thread::sleep(Duration::from_millis(SIDECAR_RESTART_COOLDOWN_MS));
        }

        match try_launch_sidecar(app, diagnostic, program, envs, health_path, timeout_secs) {
            Ok(child) => {
                diagnostic.status = if attempt == 0 {
                    String::from("started")
                } else {
                    String::from("restarted")
                };
                diagnostic.message = if attempt == 0 {
                    String::from(success_message)
                } else {
                    format!("{} after one supervised restart.", success_message)
                };
                return Some(child);
            }
            Err(error) => {
                last_error = error;
                log_sidecar(
                    app,
                    &format!(
                        "{} start attempt {} failed: {}",
                        diagnostic.name,
                        attempt + 1,
                        last_error
                    ),
                );
            }
        }
    }

    diagnostic.status = if last_error.contains("healthy in time") {
        String::from("timeout")
    } else {
        String::from("failed")
    };
    diagnostic.message = format!("{} Check the startup log.", last_error);
    None
}

fn wait_for_port(port: u16, timeout_secs: u64) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(timeout_secs) {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(350));
    }
    false
}

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

fn initial_diagnostics(app: &AppHandle) -> StartupDiagnostics {
    let resource_dir = app
        .path()
        .resource_dir()
        .map(|path| path.display().to_string())
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
                String::from("Debug mode uses the local development backend.")
            } else {
                String::from("Waiting for the packaged backend sidecar.")
            },
            port: 8000,
            binary_path: resource_bin(app, "grabix-backend.exe")
                .map(|path| path.display().to_string())
                .unwrap_or_default(),
        },
        consumet: SidecarDiagnostic {
            name: String::from("consumet"),
            status: if cfg!(debug_assertions) {
                String::from("internal")
            } else {
                String::from("internal")
            },
            message: if cfg!(debug_assertions) {
                String::from("Anime provider logic is handled inside the Python backend during development.")
            } else {
                String::from("Anime provider logic is handled inside the packaged Python backend.")
            },
            port: 0,
            binary_path: String::new(),
        },
    }
}

fn start_sidecars(app: &AppHandle) -> StartupOutcome {
    let mut children = Vec::new();
    let mut diagnostics = initial_diagnostics(app);
    let backend_path = resource_bin(app, "grabix-backend.exe");
    diagnostics.backend.binary_path = backend_path
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    diagnostics.consumet.binary_path = String::new();

    if wait_for_http_ok(8000, "/health/ping", 2) || wait_for_port(8000, 2) {
        diagnostics.backend.status = String::from("reused");
        diagnostics.backend.message = String::from("Backend is already running on port 8000.");
        log_sidecar(app, "Backend port 8000 already active. Reusing existing service.");
    } else if let Some(path) = backend_path {
        diagnostics.backend.status = String::from("starting");
        diagnostics.backend.message = format!("Launching packaged backend from {}", path.display());
        log_sidecar(app, &diagnostics.backend.message);
        if let Some(child) = start_sidecar_with_supervision(
            app,
            &mut diagnostics.backend,
            &path,
            &[],
            "/health/ping",
            12,
            "Backend is healthy on port 8000.",
        ) {
            children.push(child);
        }
    } else {
        diagnostics.backend.status = String::from("missing");
        diagnostics.backend.message =
            String::from("Packaged backend sidecar was not found in the installer resources.");
        log_sidecar(app, "Backend sidecar binary was not found.");
    }

    diagnostics.consumet.status = String::from("internal");
    diagnostics.consumet.message =
        String::from("Anime provider startup is no longer a separate sidecar dependency.");
    log_sidecar(app, "Anime provider is handled inside the Python backend. No extra sidecar launched.");

    diagnostics.startup_ready = diagnostics.backend.status == "started"
        || diagnostics.backend.status == "reused"
        || diagnostics.backend.status == "restarted";

    log_sidecar(
        app,
        &format!(
            "Startup summary -> backend: {} ({}) | consumet: {} ({})",
            diagnostics.backend.status,
            diagnostics.backend.message,
            diagnostics.consumet.status,
            diagnostics.consumet.message
        ),
    );
    write_diagnostics_snapshot(app, &diagnostics);

    StartupOutcome { children, diagnostics }
}

/// Phase 7 — Watchdog supervisor.
/// Spawned once after initial startup; polls /health/ping every 30 s.
/// On failure: emits "sidecar-reconnecting", auto-restarts the backend,
/// then emits "sidecar-reconnected" or "sidecar-failed".
fn start_watchdog(app: AppHandle) {
    thread::spawn(move || {
        // Let initial startup fully settle before the first check.
        thread::sleep(Duration::from_secs(40));

        loop {
            thread::sleep(Duration::from_secs(30));

            if wait_for_http_ok(8000, "/health/ping", 3) {
                continue; // backend healthy — nothing to do
            }

            log_sidecar(&app, "Watchdog: backend unresponsive. Attempting supervised restart.");
            let _ = app.emit("sidecar-reconnecting", ());

            // Retrieve the binary path that was stored at startup.
            let binary: Option<PathBuf> = app
                .state::<WatchdogConfig>()
                .backend_binary
                .lock()
                .ok()
                .and_then(|guard| guard.clone());

            let Some(path) = binary else {
                log_sidecar(&app, "Watchdog: no binary path stored — cannot restart.");
                let _ = app.emit("sidecar-failed", ());
                continue;
            };

            let mut diag = SidecarDiagnostic {
                name: String::from("backend"),
                port: 8000,
                binary_path: path.display().to_string(),
                status: String::from("watchdog-restarting"),
                message: String::from("Watchdog is restarting the backend."),
            };

            match start_sidecar_with_supervision(
                &app,
                &mut diag,
                &path,
                &[],
                "/health/ping",
                18,
                "Backend restarted successfully by watchdog.",
            ) {
                Some(new_child) => {
                    // Replace the old (dead) child handle.
                    if let Ok(mut children) = app.state::<SidecarState>().children.lock() {
                        for child in children.iter_mut() {
                            terminate_child_process(child);
                        }
                        children.clear();
                        children.push(new_child);
                    }
                    // Update diagnostics so the frontend UI reflects the recovery.
                    if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
                        snapshot.backend.status = String::from("restarted");
                        snapshot.backend.message =
                            String::from("Backend was automatically restarted by the watchdog.");
                        snapshot.startup_ready = true;
                        write_diagnostics_snapshot(&app, &snapshot.clone());
                    }
                    log_sidecar(&app, "Watchdog: backend restart succeeded.");
                    let _ = app.emit("sidecar-reconnected", ());
                }
                None => {
                    log_sidecar(&app, "Watchdog: backend restart failed after retries.");
                    let _ = app.emit("sidecar-failed", ());
                }
            }
        }
    });
}

fn start_sidecars_async(app: AppHandle) {
    thread::spawn(move || {
        let outcome = start_sidecars(&app);

        // Store the binary path so the watchdog can restart without re-scanning.
        if let Ok(mut guard) = app.state::<WatchdogConfig>().backend_binary.lock() {
            *guard = resource_bin(&app, "grabix-backend.exe");
        }

        if let Ok(mut stored) = app.state::<SidecarState>().children.lock() {
            *stored = outcome.children;
        }
        if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
            *snapshot = outcome.diagnostics.clone();
        }
        write_diagnostics_snapshot(&app, &outcome.diagnostics);

        // Launch the watchdog only when the backend actually started (or was reused).
        let backend_ok = matches!(
            outcome.diagnostics.backend.status.as_str(),
            "started" | "restarted" | "reused"
        );
        if backend_ok {
            start_watchdog(app);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState {
            children: Mutex::new(Vec::new()),
        })
        .manage(WatchdogConfig {
            backend_binary: Mutex::new(None),
        })
        .manage(StartupState {
            snapshot: Mutex::new(StartupDiagnostics::default()),
        })
        .setup(|app| {
            let initial = initial_diagnostics(app.handle());
            if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
                *snapshot = initial.clone();
            }
            write_diagnostics_snapshot(app.handle(), &initial);
            log_sidecar(app.handle(), "GRABIX desktop app started.");

            if cfg!(debug_assertions) {
                return Ok(());
            }

            start_sidecars_async(app.handle().clone());
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

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            let state = app_handle.state::<SidecarState>();
            let lock_result = state.children.lock();
            if let Ok(mut children) = lock_result {
                for child in children.iter_mut() {
                    terminate_child_process(child);
                }
                children.clear();
            }
        }
    });
}

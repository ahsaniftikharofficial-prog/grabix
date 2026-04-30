// ─────────────────────────────────────────────────────────────────────────────
// GRABIX — lib.rs (PyO3 embedded backend edition)
//
// Architecture change: Python is no longer a child process.
// PyO3 embeds the Python interpreter INSIDE this Rust binary.
// The FastAPI/uvicorn server runs on a Rust-managed thread.
// If the app is running, the backend is running. Crash is structurally impossible.
// ─────────────────────────────────────────────────────────────────────────────

use std::{
    fs::{create_dir_all, read_to_string, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use pyo3::prelude::*;
use rand::RngCore;
use serde::{Deserialize, Serialize};
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
const DESKTOP_AUTH_FILE_NAME: &str = "desktop-auth.json";
const RUNTIME_CONFIG_FILE_NAME: &str = "runtime-config.json";
const BACKEND_STATE_DIR_NAME: &str = "backend-state";
const GENERATED_RUNTIME_CONFIG_SUBPATH: &str = "generated/runtime-config.json";

// ── Startup state (read by React via get_startup_diagnostics) ─────────────────

struct StartupState {
    snapshot: Mutex<StartupDiagnostics>,
}

struct SidecarProcessState {
    consumet_child: Mutex<Option<Child>>,
}

#[derive(Clone, Default)]
struct DesktopAuthContext {
    token: String,
    required: bool,
    token_path: String,
    app_state_root: String,
}

struct DesktopAuthState {
    context: Mutex<DesktopAuthContext>,
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
struct DesktopAuthDiagnostic {
    required: bool,
    ready: bool,
    mode: String,
    message: String,
    token_path: String,
    app_state_root: String,
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
    desktop_auth: DesktopAuthDiagnostic,
}

#[derive(Clone, Serialize, Default)]
struct BackendRequestContext {
    desktop_auth_token: String,
    desktop_auth_required: bool,
    app_mode: String,
}

#[derive(Deserialize, Serialize)]
struct DesktopAuthPersisted {
    token: String,
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
fn get_backend_request_context(
    startup_state: State<'_, StartupState>,
    auth_state: State<'_, DesktopAuthState>,
) -> BackendRequestContext {
    let app_mode = startup_state
        .snapshot
        .lock()
        .map(|snapshot| snapshot.app_mode.clone())
        .unwrap_or_else(|_| String::from("unknown"));
    let context = auth_state
        .context
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    BackendRequestContext {
        desktop_auth_token: context.token,
        desktop_auth_required: context.required,
        app_mode,
    }
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

fn app_state_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_local_data_dir() {
        return dir;
    }
    std::env::temp_dir().join("grabix-app-state")
}

fn backend_state_dir(app: &AppHandle) -> PathBuf {
    app_state_dir(app).join(BACKEND_STATE_DIR_NAME)
}

fn desktop_auth_path(app: &AppHandle) -> PathBuf {
    app_state_dir(app).join(DESKTOP_AUTH_FILE_NAME)
}

fn runtime_config_path(app: &AppHandle) -> PathBuf {
    backend_state_dir(app).join(RUNTIME_CONFIG_FILE_NAME)
}

fn generate_desktop_auth_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{:02x}", byte)).collect()
}

fn load_or_create_desktop_auth(app: &AppHandle) -> Result<DesktopAuthContext, String> {
    let app_state = app_state_dir(app);
    create_dir_all(&app_state).map_err(|e| e.to_string())?;
    let backend_state = backend_state_dir(app);
    create_dir_all(&backend_state).map_err(|e| e.to_string())?;

    let token_path = desktop_auth_path(app);
    let token = match read_to_string(&token_path) {
        Ok(raw) => match serde_json::from_str::<DesktopAuthPersisted>(&raw) {
            Ok(payload) if !payload.token.trim().is_empty() => payload.token,
            _ => {
                let fresh = generate_desktop_auth_token();
                let payload = DesktopAuthPersisted {
                    token: fresh.clone(),
                };
                let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
                std::fs::write(&token_path, serialized).map_err(|e| e.to_string())?;
                fresh
            }
        },
        Err(_) => {
            let fresh = generate_desktop_auth_token();
            let payload = DesktopAuthPersisted {
                token: fresh.clone(),
            };
            let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
            std::fs::write(&token_path, serialized).map_err(|e| e.to_string())?;
            fresh
        }
    };

    Ok(DesktopAuthContext {
        token,
        required: !cfg!(debug_assertions),
        token_path: token_path.display().to_string(),
        app_state_root: backend_state.display().to_string(),
    })
}

fn apply_backend_runtime_env(context: &DesktopAuthContext) {
    std::env::set_var("GRABIX_APP_STATE_ROOT", &context.app_state_root);
    std::env::set_var(
        "GRABIX_RUNTIME_CONFIG_PATH",
        PathBuf::from(&context.app_state_root)
            .join(RUNTIME_CONFIG_FILE_NAME)
            .display()
            .to_string(),
    );
    if context.required {
        std::env::set_var("GRABIX_PACKAGED_MODE", "1");
        std::env::set_var("GRABIX_DESKTOP_AUTH_REQUIRED", "1");
        std::env::remove_var("GRABIX_DESKTOP_AUTH_OBSERVE_ONLY");
    } else {
        std::env::remove_var("GRABIX_PACKAGED_MODE");
        std::env::remove_var("GRABIX_DESKTOP_AUTH_REQUIRED");
        std::env::set_var("GRABIX_DESKTOP_AUTH_OBSERVE_ONLY", "1");
    }

    if context.token.is_empty() {
        std::env::remove_var("GRABIX_DESKTOP_AUTH_TOKEN");
    } else {
        std::env::set_var("GRABIX_DESKTOP_AUTH_TOKEN", &context.token);
    }
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
    let backend_candidates = [backend_resource_subdir(), "backend-staging/backend", "generated/backend"];
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
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for ancestor in exe_dir.ancestors() {
                let workspace_backend = ancestor.join("backend");
                if workspace_backend.join("main.py").exists() {
                    candidates.push(workspace_backend);
                }
            }
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

fn find_packaged_runtime_config(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(GENERATED_RUNTIME_CONFIG_SUBPATH));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join(GENERATED_RUNTIME_CONFIG_SUBPATH));
            candidates.push(exe_dir.join(GENERATED_RUNTIME_CONFIG_SUBPATH));
        }
    }
    candidates.into_iter().find(|path| path.exists())
}

fn sync_packaged_runtime_config(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let source = match find_packaged_runtime_config(app) {
        Some(path) => path,
        None => return Ok(None),
    };

    let target = runtime_config_path(app);
    if let Some(parent) = target.parent() {
        create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // FIX: Merge bundled config into existing user config instead of overwriting.
    // Previously this always clobbered the user file, wiping any settings (e.g.
    // the TMDB token) that the user had saved via the Settings page.
    //
    // Strategy: read both files as JSON objects and write a merged result where
    // the USER values win for any key that is already set to a non-empty string,
    // and the BUNDLED values fill in any key that is missing or empty.
    let bundled_raw = std::fs::read_to_string(&source).map_err(|e| e.to_string())?;

    // If target does not exist yet, just write the bundled config directly.
    if !target.exists() {
        std::fs::write(&target, &bundled_raw).map_err(|e| e.to_string())?;
        return Ok(Some(target));
    }

    // Both files exist — merge: user values win, bundled fills in blanks.
    let existing_raw = std::fs::read_to_string(&target).unwrap_or_default();
    let merged = merge_runtime_configs(&bundled_raw, &existing_raw);
    std::fs::write(&target, merged).map_err(|e| e.to_string())?;
    Ok(Some(target))
}

/// Merge two JSON config objects.  `user_raw` values win over `bundled_raw`
/// for any key where the user value is a non-empty string.  Unknown keys from
/// either side are preserved.  Falls back to `bundled_raw` on any parse error.
fn merge_runtime_configs(bundled_raw: &str, user_raw: &str) -> String {
    // Tiny hand-rolled merge — avoids pulling in serde_json for this one call.
    // Parses a flat {"key":"value",...} JSON object into a Vec of (key, value).
    fn parse_flat(raw: &str) -> Vec<(String, String)> {
        let trimmed = raw.trim().trim_start_matches('{').trim_end_matches('}');
        let mut pairs = Vec::new();
        for part in trimmed.split(',') {
            let kv: Vec<&str> = part.splitn(2, ':').collect();
            if kv.len() != 2 { continue; }
            let k = kv[0].trim().trim_matches('"').to_string();
            let v = kv[1].trim().trim_matches('"').to_string();
            if !k.is_empty() {
                pairs.push((k, v));
            }
        }
        pairs
    }

    let bundled = parse_flat(bundled_raw);
    let user = parse_flat(user_raw);

    // Build merged map: start with bundled, let user overwrite non-empty values.
    let mut merged: Vec<(String, String)> = bundled.clone();
    for (uk, uv) in &user {
        if let Some(existing) = merged.iter_mut().find(|(k, _)| k == uk) {
            if !uv.is_empty() {
                existing.1 = uv.clone();
            }
        } else {
            // Key exists in user config but not in bundled — keep it.
            merged.push((uk.clone(), uv.clone()));
        }
    }

    let fields: Vec<String> = merged
        .iter()
        .map(|(k, v)| format!("  \"{}\":\"{}\"", k, v))
        .collect();
    format!("{{
{}
}}", fields.join(",
"))
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
        desktop_auth: DesktopAuthDiagnostic {
            required: !cfg!(debug_assertions),
            ready: false,
            mode: if cfg!(debug_assertions) {
                String::from("development-observe-only")
            } else {
                String::from("packaged-required")
            },
            message: if cfg!(debug_assertions) {
                String::from("Desktop auth stays permissive in development mode.")
            } else {
                String::from("Desktop auth token will be created before the backend starts.")
            },
            token_path: desktop_auth_path(app).display().to_string(),
            app_state_root: backend_state_dir(app).display().to_string(),
        },
    }
}

// ── Ad-block JavaScript injection ─────────────────────────────────────────────
//
// This script is injected into every page the WebView loads (including inside
// iframes where possible). It activates only when the user has ad blocking
// enabled (checked via localStorage key "grabix_adblock" !== "false").
//
// Three layers of protection:
//   1. window.open() blocker — kills popup/redirect ads before they open
//   2. MutationObserver — removes ad overlay DOM elements continuously
//   3. fetch / XHR intercept — cancels requests to known ad network domains
//
// The domain blocklist here is a hardcoded fast-path (~30 worst offenders).
// The full 50k-domain list lives in the Python backend service.

const AD_BLOCK_SCRIPT: &str = r#"
(function() {
  try {
    // ── Check if ad blocker is enabled (toggle stored in localStorage) ──
    if (localStorage.getItem('grabix_adblock') === 'false') return;

    // ── 1. Block all popup windows ──────────────────────────────────────
    window.open = function() { return null; };

    // ── 2. Known ad network domains (fast hardcoded list) ───────────────
    var AD_DOMAINS = [
      'doubleclick.net','googlesyndication.com','googletagmanager.com',
      'adnxs.com','juicyads.com','exoclick.com','trafficjunky.com',
      'popads.net','popcash.net','tsyndicate.com','adskeeper.com',
      'propellerads.com','monetizer101.com','adtelligent.com',
      'revcontent.com','mgid.com','fuckingfast.net','hilltopads.net',
      'adsterra.com','yllix.com','clickadu.com','bidvertiser.com',
      'mopub.com','admob.com','inmobi.com','smartadserver.com',
      'criteo.com','outbrain.com','taboola.com','pub.network',
      'adsafeprotected.com','advertising.com','appnexus.com',
    ];

    function isAdUrl(url) {
      try {
        var host = new URL(url).hostname.toLowerCase();
        for (var i = 0; i < AD_DOMAINS.length; i++) {
          if (host === AD_DOMAINS[i] || host.endsWith('.' + AD_DOMAINS[i])) {
            return true;
          }
        }
      } catch(e) {}
      return false;
    }

    // ── 3. Intercept fetch ───────────────────────────────────────────────
    var _origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (isAdUrl(url)) return new Promise(function() {});
      return _origFetch.apply(this, arguments);
    };

    // ── 4. Intercept XMLHttpRequest ──────────────────────────────────────
    var _origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (isAdUrl(url)) {
        this._blocked = true;
        return;
      }
      return _origOpen.apply(this, arguments);
    };
    var _origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      if (this._blocked) return;
      return _origSend.apply(this, arguments);
    };

    // ── 5. DOM cleanup: remove ad overlay elements ───────────────────────
    var AD_SELECTORS = [
      '[class*="popup"]','[id*="popup"]',
      '[class*="overlay"]:not(video):not(canvas)',
      '[id*="overlay"]:not(video)',
      '[class*="ad-banner"]','[class*="ad-container"]',
      '[id*="ad-container"]','[id*="banner-ad"]',
      'iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]',
      'iframe[src*="exoclick"]','iframe[src*="juicyads"]',
      'iframe[src*="adsterra"]','iframe[src*="propellerads"]',
      '[style*="z-index: 9999"][style*="position: fixed"]',
      '[style*="z-index:9999"][style*="position:fixed"]',
    ].join(',');

    function cleanAds() {
      try {
        var els = document.querySelectorAll(AD_SELECTORS);
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          // Don't remove the video player itself
          if (el.tagName === 'VIDEO' || el.querySelector('video')) continue;
          el.remove();
        }
      } catch(e) {}
    }

    // Run immediately and on every DOM change
    cleanAds();
    var observer = new MutationObserver(cleanAds);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });

  } catch(e) {}
})();
"#;

// ── Tauri app entry point ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|webview, payload| {
            use tauri::webview::PageLoadEvent;
            if payload.event() == PageLoadEvent::Finished {
                let _ = webview.eval(AD_BLOCK_SCRIPT);
            }
        })
        // ── Fix: WebView2 white screen on Windows after minimize/restore ──────
        // WebView2 sometimes stops painting when the window is unfocused and
        // then focused again (e.g. after minimise → restore).  Nudging the
        // body opacity by a fraction forces the compositor to issue a new
        // draw command without any visible flash to the user.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                for webview in window.webviews() {
                    let _ = webview.eval(
                        "if(document.body){\
                            var s=document.body.style;\
                            s.opacity='0.99';\
                            requestAnimationFrame(function(){s.opacity='';});\
                        }",
                    );
                }
            }
        })
        .manage(StartupState {
            snapshot: Mutex::new(StartupDiagnostics::default()),
        })
        .manage(SidecarProcessState {
            consumet_child: Mutex::new(None),
        })
        .manage(DesktopAuthState {
            context: Mutex::new(DesktopAuthContext::default()),
        })
        .setup(|app| {
            let desktop_auth = load_or_create_desktop_auth(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let runtime_config_sync = sync_packaged_runtime_config(app.handle());
            apply_backend_runtime_env(&desktop_auth);
            // Tell the Python backend where Tauri's bundled resources live so it
            // can find aria2c.exe (and any other bundled tools) without downloading.
            if let Ok(resource_dir) = app.path().resource_dir() {
                std::env::set_var("GRABIX_RESOURCE_DIR", resource_dir.display().to_string());
            }
            if let Ok(mut state) = app.state::<DesktopAuthState>().context.lock() {
                *state = desktop_auth.clone();
            }

            let mut initial = initial_diagnostics(app.handle());
            initial.desktop_auth.ready = !desktop_auth.token.is_empty();
            initial.desktop_auth.required = desktop_auth.required;
            initial.desktop_auth.token_path = desktop_auth.token_path.clone();
            initial.desktop_auth.app_state_root = desktop_auth.app_state_root.clone();
            initial.desktop_auth.message = if desktop_auth.required {
                match runtime_config_sync {
                    Ok(Some(ref path)) => format!(
                        "Desktop auth token is ready and runtime config was synced to {}.",
                        path.display()
                    ),
                    Ok(None) => String::from("Desktop auth token is ready for packaged localhost protection."),
                    Err(ref error) => format!(
                        "Desktop auth token is ready, but runtime config sync failed: {}",
                        error
                    ),
                }
            } else {
                String::from("Desktop auth is running in observe-only mode for development.")
            };
            if let Ok(mut snapshot) = app.state::<StartupState>().snapshot.lock() {
                *snapshot = initial.clone();
            }
            write_diagnostics_snapshot(app.handle(), &initial);
            log_sidecar(
                app.handle(),
                &format!(
                    "GRABIX started (PyO3 embedded backend edition). build_id={} backend_hash={} desktop_auth_ready={} app_state_root={}",
                    build_id(),
                    backend_resource_hash(),
                    initial.desktop_auth.ready,
                    initial.desktop_auth.app_state_root
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
            get_backend_request_context,
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

use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    net::TcpStream,
    sync::Mutex,
    thread,
    time::Duration,
};

use tauri::{Manager, RunEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct SidecarState {
    children: Mutex<Vec<Child>>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn resource_bin(app: &tauri::AppHandle, file_name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("bin").join(file_name));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources").join("bin").join(file_name));
            candidates.push(exe_dir.join("bin").join(file_name));
            candidates.push(exe_dir.join(file_name));
        }
    }

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn spawn_process(program: &Path, envs: &[(&str, &str)]) -> Result<Child, String> {
    let mut command = Command::new(program);
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

fn wait_for_port(port: u16, timeout_secs: u64) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(timeout_secs) {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(400));
    }
    false
}

fn start_sidecars(app: &tauri::AppHandle) -> Result<Vec<Child>, String> {
    let mut children = Vec::new();

    if let Some(consumet_path) = resource_bin(app, "grabix-consumet.exe") {
        let child = spawn_process(&consumet_path, &[("PORT", "3000")])?;
        children.push(child);
        let _ = wait_for_port(3000, 20);
    }

    if let Some(backend_path) = resource_bin(app, "grabix-backend.exe") {
        let child = spawn_process(
            &backend_path,
            &[("CONSUMET_API_BASE", "http://127.0.0.1:3000")],
        )?;
        children.push(child);
        let _ = wait_for_port(8000, 20);
    }

    Ok(children)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState {
            children: Mutex::new(Vec::new()),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                return Ok(());
            }

            let children = start_sidecars(app.handle()).map_err(|message| {
                let boxed: Box<dyn std::error::Error> = message.into();
                boxed
            })?;

            let state = app.state::<SidecarState>();
            if let Ok(mut stored) = state.children.lock() {
                *stored = children;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            let state = app_handle.state::<SidecarState>();
            let lock_result = state.children.lock();
            if let Ok(mut children) = lock_result {
                for child in children.iter_mut() {
                    let _ = child.kill();
                }
                children.clear();
            }
        }
    });
}

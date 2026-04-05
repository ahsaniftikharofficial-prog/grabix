fn main() {
    println!("cargo:rerun-if-env-changed=PYO3_PYTHON");
    println!("cargo:rerun-if-env-changed=PYTHON_SYS_EXECUTABLE");
    emit_build_metadata_env("GRABIX_BUILD_ID");
    emit_build_metadata_env("GRABIX_BACKEND_RESOURCE_HASH");
    emit_build_metadata_env("GRABIX_BACKEND_RESOURCE_SUBDIR");
    ensure_resource_staging_placeholders();

    // ── Permanent DLL fix ─────────────────────────────────────────────────────
    // PyO3 links python311.dll at compile time. Windows loads ALL linked DLLs
    // before a single line of code runs, so setting PATH in Rust is too late.
    // The only reliable fix: copy python311.dll INTO the build output directory
    // right now, during compilation. Cargo then includes it next to the exe,
    // and NSIS bundles it next to the exe in the installer automatically.
    #[cfg(target_os = "windows")]
    copy_python_dll_to_output();

    tauri_build::build()
}

fn emit_build_metadata_env(name: &str) {
    println!("cargo:rerun-if-env-changed={name}");
    if let Ok(value) = std::env::var(name) {
        println!("cargo:rustc-env={name}={value}");
    }
}

fn ensure_resource_staging_placeholders() {
    use std::path::PathBuf;

    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(value) => PathBuf::from(value),
        Err(_) => return,
    };

    for relative in [
        ["backend-staging", "backend", ".placeholder"].as_slice(),
        ["consumet-staging", ".placeholder"].as_slice(),
        ["runtime-tools", ".placeholder"].as_slice(),
        ["generated", ".placeholder"].as_slice(),
    ] {
        let target = relative
            .iter()
            .fold(manifest_dir.clone(), |path, segment| path.join(segment));
        if target.exists() {
            continue;
        }

        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&target, b"generated placeholder for tauri resource glob\n");
    }
}

#[cfg(target_os = "windows")]
fn copy_python_dll_to_output() {
    use std::path::PathBuf;

    // PYO3_PYTHON = path to python.exe inside our bundled python-runtime/.
    // The DLL lives in the same directory as python.exe.
    let pyo3_python = match std::env::var("PYO3_PYTHON") {
        Ok(v) => PathBuf::from(v),
        Err(_) => {
            println!("cargo:warning=PYO3_PYTHON not set — skipping python311.dll copy.");
            return;
        }
    };

    let python_dir = match pyo3_python.parent() {
        Some(p) => p.to_path_buf(),
        None => {
            println!("cargo:warning=Cannot determine python-runtime dir from PYO3_PYTHON.");
            return;
        }
    };

    // OUT_DIR is: target/release/build/grabix-ui-<hash>/out
    // Go up 3 levels to reach: target/release/
    let out_dir = match std::env::var("OUT_DIR") {
        Ok(v) => PathBuf::from(v),
        Err(_) => return,
    };

    let target_dir = match out_dir.ancestors().nth(3) {
        Some(p) => p.to_path_buf(),
        None => {
            println!("cargo:warning=Cannot resolve target/release/ from OUT_DIR.");
            return;
        }
    };

    // Copy every .dll from python-runtime/ into target/release/.
    // This covers python311.dll, python3.dll, and any VC runtime DLLs.
    let dll_names = [
        "python311.dll",
        "python3.dll",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
    ];

    for dll_name in &dll_names {
        let src = python_dir.join(dll_name);
        if !src.exists() {
            continue; // not all builds have all DLLs — skip missing ones
        }
        let dest = target_dir.join(dll_name);
        match std::fs::copy(&src, &dest) {
            Ok(_) => println!("cargo:warning=Copied {} to target/release/", dll_name),
            Err(e) => println!("cargo:warning=Failed to copy {}: {}", dll_name, e),
        }
    }
}

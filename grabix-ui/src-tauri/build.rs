fn main() {
    emit_build_metadata_env("GRABIX_BUILD_ID");
    emit_build_metadata_env("GRABIX_BACKEND_RESOURCE_HASH");
    emit_build_metadata_env("GRABIX_BACKEND_RESOURCE_SUBDIR");
    ensure_resource_staging_placeholders();
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

    // These directories are listed as resource globs in tauri.conf.json.
    // Tauri requires the directories to exist at build time even if empty.
    // build.rs creates a .placeholder file so the glob always finds something.
    for relative in [
        ["backend-staging", "backend", ".placeholder"].as_slice(),
        ["consumet-staging", ".placeholder"].as_slice(),
        ["generated", ".placeholder"].as_slice(),
        ["backend-compiled", ".placeholder"].as_slice(),
        ["tools", ".placeholder"].as_slice(),
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

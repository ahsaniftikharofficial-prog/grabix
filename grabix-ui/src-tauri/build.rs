fn main() {
    // Tell Cargo to re-run this build script if the Python path changes.
    // PYO3_PYTHON must point to the bundled python-runtime/python.exe during builds.
    println!("cargo:rerun-if-env-changed=PYO3_PYTHON");
    println!("cargo:rerun-if-env-changed=PYTHON_SYS_EXECUTABLE");
    tauri_build::build()
}

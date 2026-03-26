// src/docker/mod.rs
// Optional Docker integration — gated on daemon availability.
// If Docker is not running, all commands return graceful errors/false.
// No panics, no required setup.

use std::process::Command;

// ── exec_prefix ───────────────────────────────────────────────────────────────
// Returns the docker exec prefix string for a given runbox container.
// Used by pty/mod.rs to wrap agent commands inside the container.
pub fn exec_prefix(runbox_id: &str) -> Result<String, String> {
    let name = container_name(runbox_id);
    Ok(format!("docker exec -i {name}"))
}

fn container_name(runbox_id: &str) -> String {
    format!("stackbox-{}", &runbox_id[..runbox_id.len().min(12)])
}

fn workspace_volume_path(runbox_id: &str) -> String {
    let local = std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()));
    format!("{local}/stackbox/workspaces/{runbox_id}/docker")
}

// ── docker_available ──────────────────────────────────────────────────────────
#[tauri::command]
pub fn docker_available() -> bool {
    Command::new("docker")
        .args(["info", "--format", "{{.ServerVersion}}"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── docker_status ─────────────────────────────────────────────────────────────
#[derive(serde::Serialize)]
pub struct DockerStatus {
    pub running:        bool,
    pub container_name: String,
    pub image:          String,
}

#[tauri::command]
pub fn docker_status(runbox_id: String) -> DockerStatus {
    let name = container_name(&runbox_id);
    let running = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Running}}", &name])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);

    DockerStatus {
        running,
        container_name: name,
        image: "node:20-alpine".to_string(),
    }
}

// ── docker_ensure ─────────────────────────────────────────────────────────────
// Creates and starts the container if it doesn't exist yet.
// Volume-mounts per-workspace storage at /workspace inside the container.
#[tauri::command]
pub fn docker_ensure(runbox_id: String, cwd: String) -> Result<String, String> {
    if !docker_available() {
        return Err("Docker daemon not available".to_string());
    }

    let name    = container_name(&runbox_id);
    let vol_dir = workspace_volume_path(&runbox_id);

    // Create volume dir if missing
    std::fs::create_dir_all(&vol_dir).map_err(|e| e.to_string())?;

    // Check if already running
    let already = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Running}}", &name])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);

    if already {
        return Ok(name);
    }

    // Remove stopped container with same name if present
    let _ = Command::new("docker").args(["rm", "-f", &name]).output();

    // Run new container — mounts cwd + per-workspace storage
    let out = Command::new("docker")
        .args([
            "run", "-d",
            "--name", &name,
            "-v", &format!("{cwd}:/workspace"),
            "-v", &format!("{vol_dir}:/stackbox-storage"),
            "-w", "/workspace",
            "--restart", "unless-stopped",
            "node:20-alpine",
            "tail", "-f", "/dev/null",   // keep alive
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() {
        Ok(name)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

// ── docker_stop ───────────────────────────────────────────────────────────────
#[tauri::command]
pub fn docker_stop(runbox_id: String) -> Result<(), String> {
    let name = container_name(&runbox_id);
    Command::new("docker")
        .args(["stop", &name])
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── docker_remove ─────────────────────────────────────────────────────────────
#[tauri::command]
pub fn docker_remove(runbox_id: String) -> Result<(), String> {
    let name = container_name(&runbox_id);
    Command::new("docker")
        .args(["rm", "-f", &name])
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
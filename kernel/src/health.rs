// src/health.rs
// GET /health — returns DB ping, uptime, memory, git availability.
// Mounted alongside the existing axum server in server.rs.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{routing::get, Json, Router};
use serde::Serialize;

use crate::db::Db;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct HealthReport {
    pub status:   &'static str,    // "ok" | "degraded"
    pub version:  &'static str,
    pub uptime_s: u64,
    pub db:       ComponentStatus,
    pub git:      ComponentStatus,
    pub memory_mb: Option<f64>,
}

#[derive(Serialize)]
pub struct ComponentStatus {
    pub ok:    bool,
    pub error: Option<String>,
}

// ── State ─────────────────────────────────────────────────────────────────────

pub struct HealthState {
    pub started_at: Instant,
    pub db:         Db,
}

// ── Handler ───────────────────────────────────────────────────────────────────

async fn health_handler(
    axum::extract::State(state): axum::extract::State<Arc<Mutex<HealthState>>>,
) -> Json<HealthReport> {
    let state  = state.lock().expect("health state poisoned");
    let uptime = state.started_at.elapsed().as_secs();

    // DB ping: try a trivial query
    let db_status = {
        let conn = state.db.lock().expect("db lock poisoned");
        match conn.execute("SELECT 1", []) {
            Ok(_)  => ComponentStatus { ok: true,  error: None },
            Err(e) => ComponentStatus { ok: false, error: Some(e.to_string()) },
        }
    };

    // Git availability
    let git_status = match std::process::Command::new("git").arg("--version").output() {
        Ok(o) if o.status.success() => ComponentStatus { ok: true,  error: None },
        Ok(o)  => ComponentStatus { ok: false, error: Some(String::from_utf8_lossy(&o.stderr).to_string()) },
        Err(e) => ComponentStatus { ok: false, error: Some(e.to_string()) },
    };

    // Resident set size (best-effort, Linux only)
    let memory_mb = read_rss_mb();

    let overall = if db_status.ok && git_status.ok { "ok" } else { "degraded" };

    Json(HealthReport {
        status:    overall,
        version:   env!("CARGO_PKG_VERSION"),
        uptime_s:  uptime,
        db:        db_status,
        git:       git_status,
        memory_mb,
    })
}

// ── Router factory ────────────────────────────────────────────────────────────

pub fn router(db: Db) -> Router {
    let state = Arc::new(Mutex::new(HealthState {
        started_at: Instant::now(),
        db,
    }));
    Router::new()
        .route("/health", get(health_handler))
        .with_state(state)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn read_rss_mb() -> Option<f64> {
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        for line in status.lines() {
            if line.starts_with("VmRSS:") {
                let kb: f64 = line
                    .split_whitespace().nth(1)?.parse().ok()?;
                return Some(kb / 1024.0);
            }
        }
    }
    None
}

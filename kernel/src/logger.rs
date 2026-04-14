// src/logger.rs
// Structured JSON log rotation via tracing + tracing-appender.
// Log level is read from CALUS_LOG env var, falling back to config.

use tracing_appender::rolling;
use tracing_subscriber::{
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Initialise the global tracing subscriber.
/// Call once in lib.rs before the Tauri builder runs.
pub fn init(log_level: &str) {
    let level = std::env::var("CALUS_LOG").unwrap_or_else(|_| log_level.to_string());

    let filter = EnvFilter::try_new(&level).unwrap_or_else(|_| EnvFilter::new("info"));

    // ── File appender: daily rotation, kept in ~/.local/share/stackbox/logs/ ──
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("calus")
        .join("logs");

    std::fs::create_dir_all(&log_dir).ok();

    let file_appender = rolling::daily(&log_dir, "calus.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Leak the guard so the file writer is never dropped for the lifetime of the process.
    // This is intentional: the process owns the log file for its entire run.
    Box::leak(Box::new(_guard));

    let file_layer = fmt::layer()
        .json()
        .with_span_events(FmtSpan::CLOSE)
        .with_writer(non_blocking);

    // ── Stderr layer: human-readable in dev ──────────────────────────────────
    let stderr_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .compact();

    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(stderr_layer)
        .init();

    tracing::info!(version = env!("CARGO_PKG_VERSION"), log_level = %level, "logger initialised");
}

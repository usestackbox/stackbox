// src/error.rs
// Unified error type for all Tauri commands.
// Every command returns Result<T, AppError>; Tauri serialises the error
// variant name + message to the frontend as a plain string.

use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Tauri(String),
    Config(String),
    NotFound(String),
    Permission(String),
    External(String),
    Internal(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(e)          => write!(f, "io: {e}"),
            AppError::Json(e)        => write!(f, "json: {e}"),
            AppError::Tauri(msg)     => write!(f, "tauri: {msg}"),
            AppError::Config(msg)    => write!(f, "config: {msg}"),
            AppError::NotFound(msg)  => write!(f, "not_found: {msg}"),
            AppError::Permission(msg)=> write!(f, "permission: {msg}"),
            AppError::External(msg)  => write!(f, "external: {msg}"),
            AppError::Internal(msg)  => write!(f, "internal: {msg}"),
        }
    }
}

// Tauri commands must return Result<T, String> — this blanket impl handles it.
impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
    }
}

impl From<std::io::Error>     for AppError { fn from(e: std::io::Error)     -> Self { AppError::Io(e) } }
impl From<serde_json::Error>  for AppError { fn from(e: serde_json::Error)  -> Self { AppError::Json(e) } }

// Convenience macro: internal!(msg) → Err(AppError::Internal(msg.into()))
#[macro_export]
macro_rules! internal {
    ($msg:expr) => { Err(crate::error::AppError::Internal($msg.into())) };
    ($fmt:literal, $($arg:tt)*) => {
        Err(crate::error::AppError::Internal(format!($fmt, $($arg)*)))
    };
}

// src-tauri/src/browser/mod.rs

pub mod webview;

pub use webview::{
    browser_create, browser_destroy, browser_navigate, browser_set_bounds,
    browser_go_back, browser_go_forward, browser_reload, browser_show, browser_hide,
};

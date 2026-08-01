//! Cognitience WP — native Windows desktop host.
//! Spawns the local Rust backend and loads the UI in WebView2 (no Electron).
//!
//! GUI builds use the Windows subsystem so double-click / Start Menu launch
//! does **not** open a console window.

// Hide the console for normal desktop use. Headless mode re-attaches a console.
#![cfg_attr(all(windows, not(test)), windows_subsystem = "windows")]

mod lifecycle;

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::{Icon, WindowBuilder},
};
use wry::WebViewBuilder;

use lifecycle::{
    build_backend_env, default_user_data_base, effective_port, health_url, resolve_app_root,
    resolve_backend_binary, resolve_data_dir, resolve_static_dir, ui_url, wait_for_health,
    APP_USER_MODEL_ID, PRODUCT_NAME, WINDOW_TITLE,
};

struct BackendGuard {
    child: Option<Child>,
}

impl BackendGuard {
    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            kill_process_tree(child.id());
            let _ = child.wait();
        }
    }
}

impl Drop for BackendGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

fn kill_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/pid", &pid.to_string(), "/f", "/t"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn exe_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("current_exe")?;
    Ok(exe
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".")))
}

/// Load window / taskbar icon from product installer logo assets.
fn load_window_icon(app_root: &Path) -> Option<Icon> {
    let candidates = [
        app_root.join("build").join("icon.png"),
        app_root.join("static").join("assets").join("logo.png"),
        app_root.join("build").join("icon.ico"),
    ];
    for path in &candidates {
        if !path.is_file() {
            continue;
        }
        // Prefer PNG via image crate (ico path may fail without ico feature).
        if path.extension().and_then(|e| e.to_str()) == Some("ico") {
            continue;
        }
        if let Some(icon) = png_to_icon(path) {
            return Some(icon);
        }
    }
    None
}

fn png_to_icon(path: &Path) -> Option<Icon> {
    let img = image::open(path).ok()?;
    // Taskbar / title-bar sized icon; large sources (1024) are downscaled.
    let rgba = img
        .resize(256, 256, image::imageops::FilterType::Lanczos3)
        .into_rgba8();
    let (w, h) = rgba.dimensions();
    Icon::from_rgba(rgba.into_raw(), w, h).ok()
}

fn start_backend(port: u16) -> Result<(BackendGuard, PathBuf)> {
    let exe_dir = exe_dir()?;
    let packaged_hint = match std::env::var("COGNITION_NATIVE_PACKAGED").as_deref() {
        Ok("1") | Ok("true") => Some(true),
        Ok("0") | Ok("false") => Some(false),
        _ => None,
    };
    let (app_root, packaged) = resolve_app_root(&exe_dir, packaged_hint);
    let backend = resolve_backend_binary(&app_root, packaged);
    if !backend.is_file() {
        bail!(
            "Backend binary not found: {}\nRun: cargo build --release (in product root)",
            backend.display()
        );
    }
    let static_dir = resolve_static_dir(&app_root, packaged);
    if !static_dir.join("index.html").is_file() {
        bail!(
            "Static UI not found: {}",
            static_dir.join("index.html").display()
        );
    }
    let data_dir = resolve_data_dir(&default_user_data_base());
    std::fs::create_dir_all(&data_dir).context("create data dir")?;

    let mut cmd = Command::new(&backend);
    cmd.current_dir(backend.parent().unwrap_or(app_root.as_path()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    for (k, v) in build_backend_env(port, &static_dir, &data_dir) {
        cmd.env(k, v);
    }
    if let Ok(v) = std::env::var("RUST_LOG") {
        cmd.env("RUST_LOG", v);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console for the console-subsystem backend.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .with_context(|| format!("spawn backend {}", backend.display()))?;

    let mut guard = BackendGuard { child: Some(child) };
    wait_for_health(port, 80, 200).map_err(|e| {
        guard.stop();
        anyhow::anyhow!(e)
    })?;
    Ok((guard, app_root))
}

fn headless_mode() -> bool {
    std::env::args().any(|a| a == "--headless")
        || matches!(
            std::env::var("COGNITION_NATIVE_HEADLESS").as_deref(),
            Ok("1") | Ok("true")
        )
}

/// Attach a console for headless/CI so readiness lines can be read.
#[cfg(windows)]
fn attach_console_for_headless() {
    unsafe {
        #[link(name = "kernel32")]
        extern "system" {
            fn AllocConsole() -> i32;
            fn AttachConsole(dw_process_id: u32) -> i32;
        }
        const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            let _ = AllocConsole();
        }
    }
}

#[cfg(not(windows))]
fn attach_console_for_headless() {}

fn run_headless(port: u16, mut backend: BackendGuard) -> Result<()> {
    attach_console_for_headless();
    println!(
        "native-host ready product=wp port={port} ui={} headless=1",
        ui_url(port)
    );
    let secs: u64 = std::env::var("COGNITION_NATIVE_HEADLESS_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    std::thread::sleep(Duration::from_secs(secs));
    backend.stop();
    Ok(())
}

fn run_gui(port: u16, mut backend: BackendGuard, app_root: &Path) -> Result<()> {
    let event_loop = EventLoop::new();
    let mut builder = WindowBuilder::new()
        .with_title(WINDOW_TITLE)
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 860.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(900.0, 600.0));

    if let Some(icon) = load_window_icon(app_root) {
        builder = builder.with_window_icon(Some(icon));
    }

    let window = builder.build(&event_loop).context("create window")?;

    let url = ui_url(port);
    let _webview = WebViewBuilder::new()
        .with_url(&url)
        .build(&window)
        .context("create WebView2 (install Microsoft Edge WebView2 Runtime if missing)")?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            backend.stop();
            *control_flow = ControlFlow::Exit;
        }
    });
}

#[cfg(windows)]
fn show_error_dialog(title: &str, message: &str) {
    use std::os::windows::ffi::OsStrExt;
    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    unsafe {
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(
                hwnd: *mut core::ffi::c_void,
                text: *const u16,
                caption: *const u16,
                utype: u32,
            ) -> i32;
        }
        const MB_OK: u32 = 0x0000_0000;
        const MB_ICONERROR: u32 = 0x0000_0010;
        let t = wide(title);
        let m = wide(message);
        MessageBoxW(
            std::ptr::null_mut(),
            m.as_ptr(),
            t.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn show_error_dialog(_title: &str, _message: &str) {}

fn main() {
    if let Err(e) = run() {
        let msg = format!("{e:#}");
        if headless_mode() {
            attach_console_for_headless();
            eprintln!("Cognitience WP native host error: {msg}");
        } else {
            show_error_dialog(PRODUCT_NAME, &msg);
        }
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let _ = (PRODUCT_NAME, APP_USER_MODEL_ID, health_url(0));
    let port = effective_port();
    let (backend, app_root) = start_backend(port)?;
    if headless_mode() {
        run_headless(port, backend)
    } else {
        run_gui(port, backend, &app_root)
    }
}

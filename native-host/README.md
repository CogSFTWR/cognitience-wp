# Cognitience WP — Native Windows host

Thin Win32 desktop shell that **does not use Electron**. It spawns the existing Rust backend (`cognition-wp.exe`), waits for `GET /api/health`, and loads the product UI in a **WebView2** window.

## Prerequisites

- Rust toolchain (MSVC)
- Microsoft Edge **WebView2** Runtime (preinstalled on most Windows 10/11 machines)
- Backend built once: `cargo build --release` from `cognition-wp/`

## Build

From `cognition-wp/`:

```bat
npm run native:build
```

Or:

```bat
cargo build --release
cargo build --release --manifest-path native-host/Cargo.toml
```

Binary: `native-host/target/release/cognition-wp-native.exe`

## Run

```bat
npm run native
```

Headless (starts backend + health wait, no window; useful for CI/HTTP checks):

```bat
set COGNITION_NATIVE_HEADLESS_SECS=20
native-host\target\release\cognition-wp-native.exe --headless
```

Default port: **8787** (`PORT` env overrides).

## Layout

- **Dev**: host walks up from its exe path until it finds `static/index.html` and uses `target/release|debug/cognition-wp.exe`.
- **Packaged**: place `cognition-wp-native.exe` next to `backend/cognition-wp.exe` and `static/`.

## Packaging

From the product root on Windows:

```bat
npm run dist
```

Produces `dist/CognitienceWP_v*_win.zip` with `CognitienceWP.exe`, `backend/`, and `static/`.

macOS and Linux natives are built in CI (`.github/workflows/native.yml`).

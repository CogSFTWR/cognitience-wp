# Cognition WP

Local-first word processor with an Apple-inspired liquid-glass UI and a **Rust** backend.

Nothing is uploaded to the cloud. Documents are JSON files on disk.

## Requirements

- Rust 1.75+ (`cargo`)
- **Windows**: Microsoft Edge WebView2 Runtime (usually preinstalled)
- **macOS / Linux**: system WebKit (built via GitHub Actions native workflow)

## Desktop app (native)

Thin desktop host (WebView2 on Windows, WKWebView/WebKit elsewhere) that spawns the Rust backend — **no Electron**.

```bash
# Windows
npm run native:build
npm run native
npm run dist          # portable zip under dist/
```

Binary (dev): `native-host/target/release/cognition-wp-native.exe`  
Portable package: `dist/CognitienceWP_v*_win.zip` → run `CognitienceWP.exe`

See `native-host/README.md`.

## Run (dev server)

```bash
cargo run
```

Then open **http://127.0.0.1:8787**

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port (localhost only) |
| `COGNITION_DATA_DIR` | `./documents` | Where `.json` documents are stored |
| `COGNITION_STATIC_DIR` | `./static` | Frontend assets |

## Features

- **Apple-style Liquid Glass** chrome
- Local document create / open / auto-save / star
- Fonts, colors, highlight, bold/italic/underline, lists, links, print

## Tests

```bash
npm test
npm run test:glass
```

## License

MIT
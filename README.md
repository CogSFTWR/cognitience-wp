# Cognition WP

Local-first word processor with an Apple-inspired liquid-glass UI and a **Rust** backend.

Nothing is uploaded to the cloud. Documents are JSON files on disk.

## Requirements

- Rust 1.75+ (`cargo`)
- A modern browser (Chrome, Edge, Firefox, Safari)

## Desktop app (Electron)

```bash
cargo build --release
npm install
npm run dist
```

Output: `dist/CognitienceWP_v2.0.0.exe` (portable)

Dark mode: moon/sun toggle in the header (persists in localStorage; follows system on first launch).

## Run (dev server)

```bash
cargo run
```

Then open **http://127.0.0.1:8787**

```bash
npm run electron:dev   # Electron shell + release backend
```

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port (localhost only) |
| `COGNITION_DATA_DIR` | `./documents` | Where `.json` documents are stored |
| `COGNITION_STATIC_DIR` | `./static` | Frontend assets |

## Features

- **Apple-style Liquid Glass** chrome: multi-layer frosted fill, blur/sat, specular rim, dynamic pointer/scroll specular + SVG refraction on specular layers, density hierarchy (heavy/medium/light). Document page stays solid white.
- Local document create / open / auto-save / star
- Fonts: Inter, Roboto, Open Sans, Merriweather, Lora, Source Serif 4, Playfair Display, JetBrains Mono, and system faces
- Font size steps of **2** (8 → 72)
- Text color + **highlight** (with “No highlight”)
- Bold / italic / underline, alignment, lists, links, print

## Tests

```bash
npm test
npm run test:glass
```

## API (local only)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health + local-mode flag |
| `GET` | `/api/documents` | List documents |
| `POST` | `/api/documents` | Create |
| `GET` | `/api/documents/{id}` | Load |
| `PUT` | `/api/documents/{id}` | Save |
| `DELETE` | `/api/documents/{id}` | Delete |

## Project layout

```
src/           Rust backend (Axum)
static/        Frontend (HTML/CSS/JS + logo)
documents/     Local document storage
```

## Shortcuts

| Key | Action |
| --- | --- |
| Ctrl/Cmd+S | Save |
| Ctrl/Cmd+B / I / U | Bold / Italic / Underline |
| Ctrl/Cmd+Z / Y | Undo / Redo |
| Ctrl/Cmd+P | Print |

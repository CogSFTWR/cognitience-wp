# Cognitience plugin system

Greenfield plugin packages for Cognitience WP / SS / PP (Rust + WebView). Not Electron.

## Package

A `.cogwp` (WP), `.cogss` (SS), or `.cogpp` (PP) file is a ZIP:

```
my-plugin.cogwp
├── cog.json      # required
├── main.js       # required
└── style.css     # optional
```

### `cog.json`

```json
{
  "id": "publisher.name",
  "name": "Display Name",
  "version": "1.0.0",
  "app": "wp",
  "main": "main.js",
  "style": "style.css"
}
```

`app` must be `wp`, `ss`, or `pp`. Wrong app → install rejected.

### Entry

```js
Cognitience.plugin.register(async (api) => {
  // use api.doc / api.ui / api.files / api.http / api.store / api.commands
  return () => { /* cleanup */ };
});
```

## HTTP API (local backend)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/plugins` | List installed |
| POST | `/api/plugins/search` | Find `*.cogwp` under Documents/Downloads |
| POST | `/api/plugins` | Multipart install |
| POST | `/api/plugins/install-path` | `{ "path": "…" }` under Documents |
| POST | `/api/plugins/{id}/enable` | Enable + (UI) load |
| POST | `/api/plugins/{id}/disable` | Disable |
| POST | `/api/plugins/{id}/uninstall` | Remove |
| POST | `/api/plugins/{id}/error` | `{ "error": "…" \| null }` |
| GET | `/api/plugins/{id}/files/{*path}` | Serve plugin asset |

Kill switch: `COGNITION_PLUGINS=0`.

## Host API (WP)

- `api.doc` — get/set HTML & title, selection, insert, `onChange` / `onOpen` / `onSave`
- `api.ui` — toolbar button, sidebar panel, notify, setStatus
- `api.commands` — add / run
- `api.files.registerOpener({ extensions, open })`
- `api.http.fetch`
- `api.store` — per-plugin localStorage

## Isolation

Core New / Open / Save / Export never await plugins. Each plugin loads in try/catch; failure disables that plugin only.

## Porting to SS / PP

1. Copy `src/plugins.rs` and `/api/plugins` routes; change `APP_ID` / `PACKAGE_EXT` (`ss`/`cogss`, `pp`/`cogpp`).
2. Copy `static/plugins.js` + Extensions panel markup/CSS.
3. Wire `CognitiencePlugins.attach({…})` with sheet- or slide-oriented `doc` (or `sheet` / `slides`) methods.
4. Keep the same `cog.json` + `register` contract.

## Examples

See [`examples/plugins/`](../examples/plugins/) — JSONL viewer and AI draft stub (`.cogwp` archives included).

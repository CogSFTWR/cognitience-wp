# Cognitience extensions

Build plugins for Cognitience WP (`.cogwp`), SS (`.cogss`), and PP (`.cogpp`). Open source, no review gates — if it installs, it runs. A crashing plugin disables itself; your documents stay on the core path.

## 1. Make a folder

```
my-plugin/
  cog.json
  main.js
  style.css   # optional
```

### cog.json

```json
{
  "id": "you.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "app": "wp",
  "main": "main.js"
}
```

Use `"app": "ss"` or `"pp"` for the other apps.

### main.js

```js
Cognitience.plugin.register(async (api) => {
  api.ui.addToolbarButton({
    title: 'Hello',
    icon: 'waving_hand',
    onClick: () => api.ui.notify('Hello from a plugin'),
  });

  return () => {
    // optional cleanup
  };
});
```

## 2. Zip it

```bash
cd my-plugin
zip -r ../my-plugin.cogwp cog.json main.js
```

Rename the suffix to `.cogss` or `.cogpp` when targeting those apps.

## 3. Install

In the app: **Extensions → Search** (looks in Documents / Downloads) → **Activate**, or **Install from file**.

## Host API (cheat sheet)

| Area | What you can do |
| --- | --- |
| `api.doc` | Read/write document HTML, title, selection; listen for change/open/save |
| `api.ui` | Toolbar buttons, sidebar panels, status / notifications |
| `api.commands` | Register and run commands |
| `api.files` | `registerOpener({ extensions: ['jsonl'], open })` |
| `api.http` | `fetch` for AI agents or any HTTP API |
| `api.store` | Per-plugin key/value (local) |

There is no permission prompt and no capability allowlist. Do what you want — just don’t expect the core editor to wait on you.

## Ideas

- **AI agent** — toolbar command reads the selection, `api.http.fetch`es your endpoint, inserts a draft.
- **JSONL** — register an opener for `.jsonl` and render rows in a sidebar panel.
- **Anything else** — themes, linters, importers, custom panels.

## Samples

Source and packaged examples live in the WP repo under `examples/plugins/` (`jsonl-viewer.cogwp`, `ai-draft.cogwp`).

## Full reference

See [PLUGIN_SYSTEM.md](https://github.com/CogSFTWR/cognitience-wp/blob/main/docs/PLUGIN_SYSTEM.md) in the Cognitience WP repository.

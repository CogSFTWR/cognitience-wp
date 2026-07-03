# Cognitience WP

**The VS Code of word processors.**

An open-source, extensible word processor built on Electron and TypeScript. Cognitience WP brings the power and flexibility of VS Code's extension ecosystem to the world of document editing.

![Cognitience WP](resources/logo.png)

## Download & Install

Download from the [releases page](https://github.com/Maq-Swarm/cognitience-wp/releases):
- `Cognitience WP Setup 1.2.0.exe` — One-click NSIS installer (desktop + Start Menu shortcuts)
- `Cognitience-WP-Portable-1.2.0.exe` — Single portable EXE (no install needed, just run)

## Features

### Core Editor
- Rich text editing with full formatting toolbar
- Headings (H1-H6), bold, italic, underline, strikethrough
- Subscript, superscript, and text highlighting
- Bullet lists, numbered lists, and checklists
- Tables, code blocks, quote blocks, horizontal rules
- Links and images
- Text and background color selection
- Font size control
- Paragraph alignment (left, center, right, justify)
- Spell check (native Hunspell, offline, custom dictionary persists across restarts), auto-save, find and replace

### Document Templates
- **arXiv Research Paper** — Academic paper format with two-column layout, abstract, sections, equations, tables, and references
- **Outline** — Hierarchical numbered outline with sections, subsections, and bullets
- **Email** — Formal email with To/From/Subject headers, greeting, body, and signature block
- **Book Manuscript** — Novel/nonfiction format with title page, copyright page, chapter headings, and scene breaks

Access via Insert → Templates, or the Command Palette.

### Export Formats
- `.cog` — Cognitience WP native format (v3.0.0: Markdown body + YAML frontmatter, human & AI readable)
- `.md` — Markdown (headings, lists, tables, code blocks, links, images, checklists)
- `.txt` — Plain text
- `.html` — Standalone HTML with embedded CSS
- `.pdf` — PDF via Electron printToPDF (A4)
- `.docx` — Microsoft Word (Office Open XML, built from scratch)
- `.doc` — Word 97-2003 (RTF format)

### User Interface
- VS Code-inspired layout: activity bar, sidebar, editor area, status bar
- Command palette (Ctrl+Shift+P) with 60+ commands
- 4 themes: Dark, Light, Sepia, High Contrast
- Focus mode for distraction-free writing
- Document outline (auto-generated from headings)
- Context menu, notification system
- Custom title bar with window controls
- Status bar (word count, reading time, cursor position, theme, spellcheck)
- In-app settings with Updates, Templates, and Plugin Development panels

### Auto-Update
- Check for updates from GitHub Releases directly in Settings
- One-click download and install

### Extension System (VS Code-style)
- `package.json` manifest with `contributes`
- Extension API: commands, editor, documents, notifications, statusBar, toolbar (SVG buttons), config, fs, logger
- Activation events: onStartup, onCommand, onLanguage, onDocumentOpen, etc.
- Install/uninstall/enable/disable/reload from Extensions sidebar
- **Plugin format: `.cogwp`** (ZIP archives, like .vsix for VS Code)
- **SVG toolbar buttons** — plugins can add buttons to the toolbar with SVG icons
- **Plugin scaffold wizard** — Help → Developer: Create New Plugin auto-generates the boilerplate
- Plugin documentation built into the Settings panel

### Plugin Compatibility (External Tools)
- JSON-RPC 2.0 over stdio protocol
- External tools (Claude Code, Codex, etc.) can plug in
- Full editor access: get/set content, selection, insertion
- Language-agnostic (Node.js, Python, anything that speaks JSON-RPC)
- **Python spellcheck** via [pyspellchecker](https://pypi.org/project/pyspellchecker/) — see `python/spellcheck.py` (`pip install pyspellchecker`)
- See [Plugin Protocol](docs/plugin-protocol.md)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New Document |
| Ctrl+O | Open File |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+F | Find |
| Ctrl+H | Replace |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+U | Underline |
| Ctrl+K | Insert Link |
| Ctrl+1-6 | Headings |
| Ctrl+Shift+P | Command Palette |
| Ctrl+Shift+F | Focus Mode |
| Ctrl+Shift+O | Toggle Outline |
| Ctrl+, | Settings |
| F11 | Full Screen |

## Build from Source

```bash
npm install
npm run build
npm start          # Run in dev
npm run package:win  # Build installer + portable EXE (Windows)
```

## Creating an Extension

See [Extension API Guide](docs/extension-api.md).

1. Use **Help → Developer: Create New Plugin** to scaffold a new plugin
2. Edit the generated `package.json`, `main.js`, and `icon.svg`
3. Zip the folder and rename to `.cogwp`
4. Install via **Extensions → Install from .cogwp...**

Or manually:
1. Create a directory in `%APPDATA%/cognitience-wp/extensions/my-extension/`
2. Add a `package.json` with manifest
3. Create `main.js` with `exports.activate = function(ctx) { ... }`
4. Restart Cognitience WP

## Architecture

- **Main Process**: WindowManager, MenuBuilder, IPCRegistry, ExtensionHost, PluginHost, ExportManager, ConfigStore, UpdateChecker
- **Preload**: Secure contextBridge (contextIsolation, no nodeIntegration, sandboxed)
- **Renderer**: HTML/CSS/JS editor with full formatting toolbar, templates, spellcheck
- **Declared runtime dependencies** — `js-yaml` (.cog), `jszip`/`jsdom` (docx export), `adm-zip` (.cogwp install), `marked`/`mammoth` (import); config stored as plain JSON

## License

MIT — © wailonbrowngh

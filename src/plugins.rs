//! Local plugin packages (.cogwp) — install, search, enable, serve assets.
//! Plugins never sit on the document save/open path; failures stay isolated.

use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

pub const APP_ID: &str = "wp";
pub const PACKAGE_EXT: &str = "cogwp";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub app: String,
    pub main: String,
    #[serde(default)]
    pub style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginStateEntry {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub error: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PluginStateFile {
    #[serde(default)]
    plugins: std::collections::HashMap<String, PluginStateEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub app: String,
    pub main: String,
    pub style: Option<String>,
    pub enabled: bool,
    pub error: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FoundPackage {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub manifest: Option<PluginManifest>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum PluginError {
    Disabled,
    NotFound,
    Invalid(String),
    Io(std::io::Error),
    Other(String),
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => write!(f, "plugins disabled"),
            Self::NotFound => write!(f, "plugin not found"),
            Self::Invalid(s) => write!(f, "{s}"),
            Self::Io(e) => write!(f, "io: {e}"),
            Self::Other(s) => write!(f, "{s}"),
        }
    }
}

impl From<std::io::Error> for PluginError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

pub fn plugins_enabled() -> bool {
    match std::env::var("COGNITION_PLUGINS") {
        Ok(v) => {
            let t = v.trim();
            !(t == "0" || t.eq_ignore_ascii_case("false") || t.eq_ignore_ascii_case("off"))
        }
        Err(_) => true,
    }
}

pub fn plugins_root(data_dir: &Path) -> PathBuf {
    data_dir.join("plugins")
}

fn state_path(data_dir: &Path) -> PathBuf {
    plugins_root(data_dir).join("state.json")
}

fn ensure_root(data_dir: &Path) -> Result<PathBuf, PluginError> {
    let root = plugins_root(data_dir);
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn load_state(data_dir: &Path) -> PluginStateFile {
    let path = state_path(data_dir);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => PluginStateFile::default(),
    }
}

fn save_state(data_dir: &Path, state: &PluginStateFile) -> Result<(), PluginError> {
    ensure_root(data_dir)?;
    let path = state_path(data_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| PluginError::Other(e.to_string()))?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn sanitize_id(id: &str) -> Result<String, PluginError> {
    let cleaned: String = id
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '-' => c,
            _ => '_',
        })
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." || cleaned.contains("..") {
        return Err(PluginError::Invalid("invalid plugin id".into()));
    }
    Ok(cleaned)
}

fn read_manifest_from_dir(dir: &Path) -> Result<PluginManifest, PluginError> {
    let path = dir.join("cog.json");
    let raw = fs::read_to_string(&path)
        .map_err(|_| PluginError::Invalid("missing cog.json".into()))?;
    let m: PluginManifest = serde_json::from_str(&raw)
        .map_err(|e| PluginError::Invalid(format!("invalid cog.json: {e}")))?;
    if m.id.trim().is_empty() {
        return Err(PluginError::Invalid("cog.json: id required".into()));
    }
    if m.main.trim().is_empty() {
        return Err(PluginError::Invalid("cog.json: main required".into()));
    }
    if m.app != APP_ID {
        return Err(PluginError::Invalid(format!(
            "this package is for app '{}'; Cognitience WP only accepts '{APP_ID}' (.cogwp)",
            m.app
        )));
    }
    if !dir.join(&m.main).is_file() {
        return Err(PluginError::Invalid(format!(
            "main entry not found: {}",
            m.main
        )));
    }
    if let Some(style) = &m.style {
        if !style.is_empty() && !dir.join(style).is_file() {
            return Err(PluginError::Invalid(format!("style not found: {style}")));
        }
    }
    Ok(m)
}

fn peek_manifest_in_zip(bytes: &[u8]) -> Result<PluginManifest, PluginError> {
    let cursor = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| PluginError::Invalid(format!("invalid zip: {e}")))?;
    let mut cog_idx: Option<usize> = None;
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| PluginError::Other(e.to_string()))?
            .name()
            .replace('\\', "/")
            .to_string();
        if name.ends_with("cog.json") && !name.contains("__MACOSX") {
            // Prefer shallowest cog.json
            match cog_idx {
                None => cog_idx = Some(i),
                Some(prev) => {
                    let prev_name = archive.by_index(prev).ok().map(|f| f.name().to_string());
                    let prev_depth = prev_name
                        .as_deref()
                        .map(|n| n.matches('/').count())
                        .unwrap_or(99);
                    let depth = name.matches('/').count();
                    if depth < prev_depth {
                        cog_idx = Some(i);
                    }
                }
            }
        }
    }
    let idx = cog_idx.ok_or_else(|| PluginError::Invalid("no cog.json in package".into()))?;
    let mut file = archive
        .by_index(idx)
        .map_err(|e| PluginError::Other(e.to_string()))?;
    let mut raw = String::new();
    file.read_to_string(&mut raw)
        .map_err(|e| PluginError::Other(e.to_string()))?;
    let m: PluginManifest = serde_json::from_str(&raw)
        .map_err(|e| PluginError::Invalid(format!("invalid cog.json: {e}")))?;
    if m.app != APP_ID {
        return Err(PluginError::Invalid(format!(
            "this package is for app '{}'; Cognitience WP only accepts '{APP_ID}' (.cogwp)",
            m.app
        )));
    }
    Ok(m)
}

fn extract_zip_to(bytes: &[u8], dest: &Path) -> Result<(), PluginError> {
    if dest.exists() {
        fs::remove_dir_all(dest)?;
    }
    fs::create_dir_all(dest)?;

    let cursor = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| PluginError::Invalid(format!("invalid zip: {e}")))?;

    // Detect single top-level folder to strip
    let mut tops = std::collections::BTreeSet::new();
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| PluginError::Other(e.to_string()))?
            .name()
            .replace('\\', "/");
        if name.starts_with("__MACOSX") {
            continue;
        }
        let top = name.split('/').next().unwrap_or("").to_string();
        if !top.is_empty() {
            tops.insert(top);
        }
    }
    let strip_prefix = if tops.len() == 1 {
        Some(tops.iter().next().unwrap().clone())
    } else {
        None
    };

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| PluginError::Other(e.to_string()))?;
        let raw_name = file.name().replace('\\', "/");
        if raw_name.starts_with("__MACOSX") || raw_name.is_empty() {
            continue;
        }
        let rel = if let Some(ref prefix) = strip_prefix {
            let p = format!("{prefix}/");
            if raw_name == *prefix || raw_name == format!("{prefix}/") {
                continue;
            }
            if let Some(rest) = raw_name.strip_prefix(&p) {
                rest.to_string()
            } else {
                raw_name.clone()
            }
        } else {
            raw_name.clone()
        };
        if rel.is_empty() {
            continue;
        }
        let out = safe_join(dest, &rel)?;
        if file.is_dir() || raw_name.ends_with('/') {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut outfile = fs::File::create(&out)?;
        std::io::copy(&mut file, &mut outfile)?;
        // Ensure we flush
        outfile.flush()?;
    }
    Ok(())
}

fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, PluginError> {
    let rel = rel.replace('\\', "/");
    let mut out = base.to_path_buf();
    for comp in Path::new(&rel).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => {
                return Err(PluginError::Invalid(
                    "path traversal blocked in plugin package".into(),
                ))
            }
        }
    }
    if !out.starts_with(base) {
        return Err(PluginError::Invalid("path escape blocked".into()));
    }
    Ok(out)
}

pub fn list_installed(data_dir: &Path) -> Result<Vec<InstalledPlugin>, PluginError> {
    if !plugins_enabled() {
        return Ok(vec![]);
    }
    let root = ensure_root(data_dir)?;
    let state = load_state(data_dir);
    let mut out = Vec::new();
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name.starts_with('.') {
            continue;
        }
        let dir = entry.path();
        let manifest = match read_manifest_from_dir(&dir) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let st = state
            .plugins
            .get(&manifest.id)
            .cloned()
            .unwrap_or_default();
        out.push(InstalledPlugin {
            id: manifest.id.clone(),
            name: manifest.name,
            version: manifest.version,
            app: manifest.app,
            main: manifest.main,
            style: manifest.style,
            enabled: st.enabled,
            error: st.error,
            path: dir.display().to_string(),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn install_from_bytes(data_dir: &Path, filename: &str, bytes: &[u8]) -> Result<InstalledPlugin, PluginError> {
    if !plugins_enabled() {
        return Err(PluginError::Disabled);
    }
    let lower = filename.to_lowercase();
    if !lower.ends_with(&format!(".{PACKAGE_EXT}")) && !lower.ends_with(".zip") {
        return Err(PluginError::Invalid(format!(
            "expected .{PACKAGE_EXT} package"
        )));
    }
    let peek = peek_manifest_in_zip(bytes)?;
    let id = sanitize_id(&peek.id)?;
    let root = ensure_root(data_dir)?;
    let dest = root.join(&id);
    extract_zip_to(bytes, &dest)?;
    let manifest = read_manifest_from_dir(&dest)?;
    let id = sanitize_id(&manifest.id)?;
    // If folder name != id (sanitized), rename
    let final_dir = root.join(&id);
    if dest != final_dir {
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir)?;
        }
        fs::rename(&dest, &final_dir)?;
    }
    let mut state = load_state(data_dir);
    state.plugins.insert(
        id.clone(),
        PluginStateEntry {
            enabled: true,
            error: None,
        },
    );
    save_state(data_dir, &state)?;
    let m = read_manifest_from_dir(&final_dir)?;
    Ok(InstalledPlugin {
        id: m.id,
        name: m.name,
        version: m.version,
        app: m.app,
        main: m.main,
        style: m.style,
        enabled: true,
        error: None,
        path: final_dir.display().to_string(),
    })
}

pub fn install_from_path(data_dir: &Path, docs_dir: &Path, rel_or_abs: &str) -> Result<InstalledPlugin, PluginError> {
    if !plugins_enabled() {
        return Err(PluginError::Disabled);
    }
    let path = resolve_under_docs_or_abs(docs_dir, rel_or_abs)?;
    let bytes = fs::read(&path)?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("plugin.{PACKAGE_EXT}"));
    install_from_bytes(data_dir, &name, &bytes)
}

fn resolve_under_docs_or_abs(docs_dir: &Path, input: &str) -> Result<PathBuf, PluginError> {
    let p = PathBuf::from(input);
    if p.is_absolute() {
        if p.exists() {
            return Ok(p);
        }
        return Err(PluginError::NotFound);
    }
    let joined = docs_dir.join(input);
    if joined.exists() {
        // Ensure stays under docs
        let canon_docs = fs::canonicalize(docs_dir).unwrap_or_else(|_| docs_dir.to_path_buf());
        let canon = fs::canonicalize(&joined).unwrap_or(joined.clone());
        if canon.starts_with(&canon_docs) {
            return Ok(canon);
        }
        return Err(PluginError::Invalid("path outside Documents".into()));
    }
    Err(PluginError::NotFound)
}

pub fn set_enabled(data_dir: &Path, id: &str, enabled: bool) -> Result<InstalledPlugin, PluginError> {
    if !plugins_enabled() {
        return Err(PluginError::Disabled);
    }
    let id = sanitize_id(id)?;
    let dir = plugins_root(data_dir).join(&id);
    if !dir.is_dir() {
        return Err(PluginError::NotFound);
    }
    let mut state = load_state(data_dir);
    let entry = state.plugins.entry(id.clone()).or_default();
    entry.enabled = enabled;
    if enabled {
        entry.error = None;
    }
    save_state(data_dir, &state)?;
    list_installed(data_dir)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or(PluginError::NotFound)
}

pub fn set_error(data_dir: &Path, id: &str, error: Option<String>) -> Result<(), PluginError> {
    let id = sanitize_id(id)?;
    let mut state = load_state(data_dir);
    let entry = state.plugins.entry(id).or_default();
    entry.error = error;
    if entry.error.is_some() {
        entry.enabled = false;
    }
    save_state(data_dir, &state)?;
    Ok(())
}

pub fn uninstall(data_dir: &Path, id: &str) -> Result<(), PluginError> {
    if !plugins_enabled() {
        return Err(PluginError::Disabled);
    }
    let id = sanitize_id(id)?;
    let dir = plugins_root(data_dir).join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    let mut state = load_state(data_dir);
    state.plugins.remove(&id);
    save_state(data_dir, &state)?;
    Ok(())
}

pub fn read_plugin_file(data_dir: &Path, id: &str, rel: &str) -> Result<(Vec<u8>, &'static str), PluginError> {
    if !plugins_enabled() {
        return Err(PluginError::Disabled);
    }
    let id = sanitize_id(id)?;
    let base = plugins_root(data_dir).join(&id);
    if !base.is_dir() {
        return Err(PluginError::NotFound);
    }
    let path = safe_join(&base, rel)?;
    if !path.is_file() {
        return Err(PluginError::NotFound);
    }
    let bytes = fs::read(&path)?;
    let mime = mime_for(&path);
    Ok((bytes, mime))
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub fn search_packages(docs_dir: &Path) -> Result<Vec<FoundPackage>, PluginError> {
    if !plugins_enabled() {
        return Ok(vec![]);
    }
    let mut roots = vec![docs_dir.to_path_buf()];
    if let Some(home) = dirs::home_dir() {
        let downloads = home.join("Downloads");
        if downloads.is_dir() {
            roots.push(downloads);
        }
    }
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in roots {
        scan_dir_for_packages(&root, &root, 0, 4, &mut found, &mut seen)?;
    }
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(found)
}

fn scan_dir_for_packages(
    root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<FoundPackage>,
    seen: &mut std::collections::HashSet<String>,
) -> Result<(), PluginError> {
    if depth > max_depth {
        return Ok(());
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            // Skip heavy / irrelevant trees
            let lower = name.to_lowercase();
            if matches!(
                lower.as_str(),
                "node_modules" | "target" | ".git" | "library" | "appdata" | "application support"
            ) {
                continue;
            }
            scan_dir_for_packages(root, &path, depth + 1, max_depth, out, seen)?;
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let lower = name.to_lowercase();
        if !lower.ends_with(&format!(".{PACKAGE_EXT}")) {
            continue;
        }
        let key = path.display().to_string();
        if !seen.insert(key.clone()) {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let rel = path
            .strip_prefix(root)
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| path.display().to_string());
        let (manifest, error) = match fs::read(&path) {
            Ok(bytes) => match peek_manifest_in_zip(&bytes) {
                Ok(m) => (Some(m), None),
                Err(e) => (None, Some(e.to_string())),
            },
            Err(e) => (None, Some(e.to_string())),
        };
        out.push(FoundPackage {
            path: if path.starts_with(root) {
                rel.replace('\\', "/")
            } else {
                path.display().to_string()
            },
            name,
            size,
            manifest,
            error,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn make_cogwp(id: &str, app: &str) -> Vec<u8> {
        let buf = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(buf);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("demo/cog.json", opts).unwrap();
        write!(
            zip,
            r#"{{"id":"{id}","name":"Demo","version":"1.0.0","app":"{app}","main":"main.js"}}"#
        )
        .unwrap();
        zip.start_file("demo/main.js", opts).unwrap();
        write!(
            zip,
            "Cognitience.plugin.register(async (api) => {{ api.ui.notify('hi'); }});"
        )
        .unwrap();
        let cursor = zip.finish().unwrap();
        cursor.into_inner()
    }

    #[test]
    fn install_and_list_and_serve() {
        let dir = std::env::temp_dir().join(format!("cog-plugins-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bytes = make_cogwp("demo.hello", "wp");
        let installed = install_from_bytes(&dir, "hello.cogwp", &bytes).expect("install");
        assert_eq!(installed.id, "demo.hello");
        assert!(installed.enabled);
        let list = list_installed(&dir).unwrap();
        assert_eq!(list.len(), 1);
        let (js, mime) = read_plugin_file(&dir, "demo.hello", "main.js").unwrap();
        assert!(mime.contains("javascript"));
        assert!(!js.is_empty());
        set_enabled(&dir, "demo.hello", false).unwrap();
        let list = list_installed(&dir).unwrap();
        assert!(!list[0].enabled);
        uninstall(&dir, "demo.hello").unwrap();
        assert!(list_installed(&dir).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_wrong_app() {
        let dir = std::env::temp_dir().join(format!("cog-plugins-bad-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bytes = make_cogwp("demo.ss", "ss");
        let err = install_from_bytes(&dir, "x.cogwp", &bytes).unwrap_err();
        assert!(err.to_string().contains("ss"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn blocks_path_traversal() {
        let dir = std::env::temp_dir().join(format!("cog-plugins-trav-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bytes = make_cogwp("demo.ok", "wp");
        install_from_bytes(&dir, "ok.cogwp", &bytes).unwrap();
        let err = read_plugin_file(&dir, "demo.ok", "../secret.txt").unwrap_err();
        assert!(matches!(err, PluginError::Invalid(_)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_finds_cogwp_in_docs() {
        let docs = std::env::temp_dir().join(format!("cog-docs-search-{}", std::process::id()));
        let _ = fs::remove_dir_all(&docs);
        fs::create_dir_all(&docs).unwrap();
        let bytes = make_cogwp("search.me", "wp");
        fs::write(docs.join("mine.cogwp"), &bytes).unwrap();
        let found = search_packages(&docs).unwrap();
        assert!(found.iter().any(|f| f.name == "mine.cogwp"));
        assert!(found
            .iter()
            .any(|f| f.manifest.as_ref().map(|m| m.id.as_str()) == Some("search.me")));
        let _ = fs::remove_dir_all(&docs);
    }
}

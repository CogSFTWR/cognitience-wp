//! User Documents folder listing + open/import for txt, md, docx, pdf.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

/// Extensions shown in the Documents sidebar (and generally openable as library files).
const LIST_EXT: &[&str] = &["txt", "md", "markdown", "docx", "pdf"];
/// Also openable via Open/Import, but not listed in the sidebar.
const OPEN_EXT: &[&str] = &["txt", "md", "markdown", "docx", "pdf", "html", "htm", "json", "cog"];

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub ext: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenedFile {
    pub name: String,
    pub path: String,
    pub ext: String,
    pub title: String,
    pub html: String,
    pub markdown: Option<String>,
    pub format: String,
    /// When true, frontend should open `view_url` / embed PDF instead of HTML body.
    #[serde(default)]
    pub binary: bool,
    /// Relative API path for streaming original bytes (e.g. /api/files/raw?path=…)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_url: Option<String>,
    /// Base64 payload when the file is not on disk under Documents (import).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_base64: Option<String>,
    /// MIME type for binary views
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenPathBody {
    pub path: String,
}

#[derive(Debug)]
pub enum FileError {
    NotFound,
    InvalidPath,
    Unsupported,
    Io(std::io::Error),
    Other(String),
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "file not found"),
            Self::InvalidPath => write!(f, "invalid path"),
            Self::Unsupported => write!(f, "unsupported file type"),
            Self::Io(e) => write!(f, "io: {e}"),
            Self::Other(s) => write!(f, "{s}"),
        }
    }
}

pub fn resolve_documents_dir() -> PathBuf {
    if let Ok(p) = std::env::var("COGNITION_DOCS_DIR") {
        return PathBuf::from(p);
    }
    dirs::document_dir().unwrap_or_else(|| {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        home.join("Documents")
    })
}

pub fn list_documents_folder(root: &Path) -> Result<Vec<FileEntry>, FileError> {
    if !root.exists() {
        fs::create_dir_all(root).map_err(FileError::Io)?;
    }
    let mut out = Vec::new();
    collect_files(root, root, 0, &mut out)?;
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn collect_files(
    root: &Path,
    dir: &Path,
    depth: u8,
    out: &mut Vec<FileEntry>,
) -> Result<(), FileError> {
    if depth > 3 {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(FileError::Io)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(root, &path, depth + 1, out)?;
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !LIST_EXT.contains(&ext.as_str()) {
            continue;
        }
        let meta = entry.metadata().map_err(FileError::Io)?;
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(FileEntry {
            name,
            path: rel,
            ext: ext.clone(),
            size: meta.len(),
            kind: kind_for_ext(&ext).into(),
        });
    }
    Ok(())
}

fn kind_for_ext(ext: &str) -> &'static str {
    match ext {
        "md" | "markdown" => "markdown",
        "txt" => "text",
        "docx" => "word",
        "pdf" => "pdf",
        "html" | "htm" => "html",
        "json" | "cog" => "cognition",
        _ => "file",
    }
}

/// Resolve a relative path under Documents; reject path traversal.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, FileError> {
    let rel = rel.trim().trim_start_matches(['/', '\\']);
    if rel.is_empty() {
        return Err(FileError::InvalidPath);
    }
    let candidate = root.join(rel);
    let canon_root = fs::canonicalize(root).map_err(FileError::Io)?;
    // File may not exist yet for save — canonicalize parent when possible.
    let full = if candidate.exists() {
        fs::canonicalize(&candidate).map_err(FileError::Io)?
    } else {
        // Normalize without requiring existence
        let mut norm = PathBuf::new();
        for c in Path::new(rel).components() {
            match c {
                Component::Normal(s) => norm.push(s),
                Component::CurDir => {}
                _ => return Err(FileError::InvalidPath),
            }
        }
        if norm.as_os_str().is_empty() {
            return Err(FileError::InvalidPath);
        }
        return Ok(root.join(norm));
    };
    if !full.starts_with(&canon_root) {
        return Err(FileError::InvalidPath);
    }
    Ok(full)
}

pub fn open_file(root: &Path, rel: &str) -> Result<OpenedFile, FileError> {
    let path = safe_join(root, rel)?;
    if !path.is_file() {
        return Err(FileError::NotFound);
    }
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled document".into());

    let bytes = fs::read(&path).map_err(FileError::Io)?;
    open_bytes_with_options(&name, rel, &ext, &title, &bytes, true)
}

pub fn open_bytes(
    name: &str,
    rel: &str,
    ext: &str,
    title: &str,
    bytes: &[u8],
) -> Result<OpenedFile, FileError> {
    open_bytes_with_options(name, rel, ext, title, bytes, false)
}

/// `from_disk`: when true, PDF is served via `/api/files/raw` instead of base64.
pub fn open_bytes_with_options(
    name: &str,
    rel: &str,
    ext: &str,
    title: &str,
    bytes: &[u8],
    from_disk: bool,
) -> Result<OpenedFile, FileError> {
    match ext {
        "txt" => {
            let text = decode_text(bytes);
            Ok(OpenedFile {
                name: name.into(),
                path: rel.into(),
                ext: ext.into(),
                title: title.into(),
                html: plain_to_html(&text),
                markdown: None,
                format: "text".into(),
                binary: false,
                view_url: None,
                binary_base64: None,
                mime: Some("text/plain".into()),
            })
        }
        "md" | "markdown" => {
            let md = decode_text(bytes);
            Ok(OpenedFile {
                name: name.into(),
                path: rel.into(),
                ext: "md".into(),
                title: title.into(),
                html: markdown_to_html(&md),
                markdown: Some(md),
                format: "markdown".into(),
                binary: false,
                view_url: None,
                binary_base64: None,
                mime: Some("text/markdown".into()),
            })
        }
        "html" | "htm" => {
            let html = decode_text(bytes);
            Ok(OpenedFile {
                name: name.into(),
                path: rel.into(),
                ext: ext.into(),
                title: title.into(),
                html,
                markdown: None,
                format: "html".into(),
                binary: false,
                view_url: None,
                binary_base64: None,
                mime: Some("text/html".into()),
            })
        }
        "json" | "cog" => {
            #[derive(Deserialize)]
            struct Doc {
                title: Option<String>,
                html: Option<String>,
            }
            let doc: Doc = serde_json::from_slice(bytes)
                .map_err(|e| FileError::Other(format!("invalid cognition file: {e}")))?;
            Ok(OpenedFile {
                name: name.into(),
                path: rel.into(),
                ext: ext.into(),
                title: doc.title.unwrap_or_else(|| title.into()),
                html: doc.html.unwrap_or_default(),
                markdown: None,
                format: "cognition".into(),
                binary: false,
                view_url: None,
                binary_base64: None,
                mime: Some("application/json".into()),
            })
        }
        "docx" => {
            let text = extract_docx_text(bytes)?;
            let html = if text.trim().is_empty() {
                "<p><em>(No extractable text found in this Word document.)</em></p>".into()
            } else {
                plain_to_html(&text)
            };
            Ok(OpenedFile {
                name: name.into(),
                path: rel.into(),
                ext: ext.into(),
                title: title.into(),
                html,
                markdown: None,
                format: "docx".into(),
                binary: false,
                view_url: None,
                binary_base64: None,
                mime: Some(
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        .into(),
                ),
            })
        }
        "pdf" => {
            // Display the real PDF in the client viewer — never dump raw streams as text.
            let view_url = if from_disk && !rel.is_empty() {
                Some(format!(
                    "/api/files/raw?path={}",
                    urlencoding_encode(rel)
                ))
            } else {
                None
            };
            let binary_base64 = if view_url.is_none() {
                use base64::Engine;
                Some(base64::engine::general_purpose::STANDARD.encode(bytes))
            } else {
                None
            };
            Ok(OpenedFile {
                name: name.into(),
                path: rel.into(),
                ext: "pdf".into(),
                title: title.into(),
                html: String::new(),
                markdown: None,
                format: "pdf".into(),
                binary: true,
                view_url,
                binary_base64,
                mime: Some("application/pdf".into()),
            })
        }
        _ => Err(FileError::Unsupported),
    }
}

#[allow(dead_code)]
fn is_openable_ext(ext: &str) -> bool {
    OPEN_EXT.contains(&ext)
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Decode UTF-8 / UTF-16 text files with BOM awareness.
fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return strip_bom(&String::from_utf8_lossy(&bytes[3..]));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) && bytes.len() >= 2 {
        let u16s: Vec<u16> = bytes[2..]
            .chunks(2)
            .filter(|c| c.len() == 2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) && bytes.len() >= 2 {
        let u16s: Vec<u16> = bytes[2..]
            .chunks(2)
            .filter(|c| c.len() == 2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&u16s);
    }
    strip_bom(&String::from_utf8_lossy(bytes))
}

fn strip_bom(s: &str) -> String {
    s.trim_start_matches('\u{feff}').to_string()
}

fn plain_to_html(text: &str) -> String {
    let mut out = String::new();
    for para in text.split("\n\n") {
        let line = para.replace('\n', "<br>");
        let esc = html_escape(&line);
        // restore br tags we intentionally inserted
        let with_br = esc.replace("&lt;br&gt;", "<br>");
        out.push_str(&format!("<p>{with_br}</p>"));
    }
    if out.is_empty() {
        out.push_str("<p></p>");
    }
    out
}

/// Minimal markdown → HTML (headings, bold, italic, code, lists, links, paragraphs).
pub fn markdown_to_html(md: &str) -> String {
    let mut html = String::new();
    let mut in_ul = false;
    let mut in_ol = false;

    for raw in md.lines() {
        let line = raw.trim_end();
        if line.is_empty() {
            close_lists(&mut html, &mut in_ul, &mut in_ol);
            continue;
        }
        if let Some(rest) = line.strip_prefix("### ") {
            close_lists(&mut html, &mut in_ul, &mut in_ol);
            html.push_str(&format!("<h3>{}</h3>", inline_md(rest)));
            continue;
        }
        if let Some(rest) = line.strip_prefix("## ") {
            close_lists(&mut html, &mut in_ul, &mut in_ol);
            html.push_str(&format!("<h2>{}</h2>", inline_md(rest)));
            continue;
        }
        if let Some(rest) = line.strip_prefix("# ") {
            close_lists(&mut html, &mut in_ul, &mut in_ol);
            html.push_str(&format!("<h1>{}</h1>", inline_md(rest)));
            continue;
        }
        if let Some(rest) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
            if in_ol {
                html.push_str("</ol>");
                in_ol = false;
            }
            if !in_ul {
                html.push_str("<ul>");
                in_ul = true;
            }
            html.push_str(&format!("<li>{}</li>", inline_md(rest)));
            continue;
        }
        if let Some(rest) = line
            .chars()
            .next()
            .filter(|c| c.is_ascii_digit())
            .and_then(|_| {
                let parts: Vec<_> = line.splitn(2, ". ").collect();
                if parts.len() == 2 && parts[0].chars().all(|c| c.is_ascii_digit()) {
                    Some(parts[1])
                } else {
                    None
                }
            })
        {
            if in_ul {
                html.push_str("</ul>");
                in_ul = false;
            }
            if !in_ol {
                html.push_str("<ol>");
                in_ol = true;
            }
            html.push_str(&format!("<li>{}</li>", inline_md(rest)));
            continue;
        }
        close_lists(&mut html, &mut in_ul, &mut in_ol);
        html.push_str(&format!("<p>{}</p>", inline_md(line)));
    }
    close_lists(&mut html, &mut in_ul, &mut in_ol);
    if html.is_empty() {
        html.push_str("<p></p>");
    }
    html
}

fn close_lists(html: &mut String, in_ul: &mut bool, in_ol: &mut bool) {
    if *in_ul {
        html.push_str("</ul>");
        *in_ul = false;
    }
    if *in_ol {
        html.push_str("</ol>");
        *in_ol = false;
    }
}

fn inline_md(s: &str) -> String {
    let mut out = html_escape(s);
    // links [text](url)
    out = regex_replace_links(&out);
    // bold ** **
    out = replace_delimited(&out, "**", "<strong>", "</strong>");
    // italic * *
    out = replace_delimited(&out, "*", "<em>", "</em>");
    // inline code ` `
    out = replace_delimited(&out, "`", "<code>", "</code>");
    out
}

fn regex_replace_links(s: &str) -> String {
    // Simple [label](url) pass
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some(end_label) = chars[i + 1..].iter().position(|&c| c == ']') {
                let label_end = i + 1 + end_label;
                if label_end + 1 < chars.len() && chars[label_end + 1] == '(' {
                    if let Some(end_url) = chars[label_end + 2..].iter().position(|&c| c == ')') {
                        let url_end = label_end + 2 + end_url;
                        let label: String = chars[i + 1..label_end].iter().collect();
                        let url: String = chars[label_end + 2..url_end].iter().collect();
                        out.push_str(&format!("<a href=\"{url}\">{label}</a>"));
                        i = url_end + 1;
                        continue;
                    }
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn replace_delimited(s: &str, delim: &str, open: &str, close: &str) -> String {
    let parts: Vec<&str> = s.split(delim).collect();
    if parts.len() < 3 {
        return s.to_string();
    }
    let mut out = String::new();
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            if i % 2 == 1 {
                out.push_str(open);
            } else {
                out.push_str(close);
            }
        }
        out.push_str(part);
    }
    // odd number of delims leaves open tag — fine for simple editor use
    out
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn extract_docx_text(bytes: &[u8]) -> Result<String, FileError> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| FileError::Other(e.to_string()))?;
    let mut file = archive
        .by_name("word/document.xml")
        .map_err(|_| FileError::Other("docx missing word/document.xml".into()))?;
    let mut xml = String::new();
    file.read_to_string(&mut xml)
        .map_err(|e| FileError::Other(e.to_string()))?;
    Ok(xml_docx_to_text(&xml))
}

fn xml_docx_to_text(xml: &str) -> String {
    let mut text = String::new();
    let mut in_t = false;
    let mut buf = String::new();
    let mut chars = xml.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            for tc in chars.by_ref() {
                if tc == '>' {
                    break;
                }
                tag.push(tc);
            }
            let t = tag.trim();
            if t == "w:t" || t.starts_with("w:t ") {
                in_t = true;
                buf.clear();
            } else if t == "/w:t" {
                in_t = false;
                text.push_str(&buf);
            } else if t == "w:p" || t.starts_with("w:p ") {
                if !text.is_empty() && !text.ends_with('\n') {
                    text.push('\n');
                }
            } else if t == "w:br" || t.starts_with("w:br ") || t == "w:br/" {
                text.push('\n');
            }
        } else if in_t {
            buf.push(c);
        }
    }
    text
}

/// MIME type for a relative Documents path.
pub fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "pdf" => "application/pdf",
        "txt" => "text/plain; charset=utf-8",
        "md" | "markdown" => "text/markdown; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "json" | "cog" => "application/json",
        _ => "application/octet-stream",
    }
}

pub fn read_raw_file(root: &Path, rel: &str) -> Result<(Vec<u8>, &'static str), FileError> {
    let path = safe_join(root, rel)?;
    if !path.is_file() {
        return Err(FileError::NotFound);
    }
    let data = fs::read(&path).map_err(FileError::Io)?;
    Ok((data, mime_for_path(&path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn md_bold() {
        let h = markdown_to_html("Hello **world**");
        assert!(h.contains("<strong>world</strong>"));
    }

    #[test]
    fn plain_paras() {
        let h = plain_to_html("a\n\nb");
        assert!(h.contains("<p>"));
    }

    /// Minimal valid single-page PDF bytes used by open tests.
    fn sample_pdf_bytes() -> Vec<u8> {
        br#"%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 50 80 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000359 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
434
%%EOF
"#
        .to_vec()
    }

    #[test]
    fn open_pdf_from_disk_is_binary_with_view_url() {
        let dir = std::env::temp_dir().join(format!(
            "cognition-pdf-open-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let pdf_path = dir.join("fixture.pdf");
        {
            let mut f = fs::File::create(&pdf_path).unwrap();
            f.write_all(&sample_pdf_bytes()).unwrap();
        }

        let opened = open_file(&dir, "fixture.pdf").expect("open pdf");
        assert_eq!(opened.format, "pdf");
        assert_eq!(opened.ext, "pdf");
        assert!(opened.binary, "PDF must be marked binary");
        assert!(opened.html.is_empty(), "must not dump PDF into html");
        assert_eq!(opened.mime.as_deref(), Some("application/pdf"));
        let view = opened.view_url.expect("view_url for disk PDF");
        assert!(
            view.contains("/api/files/raw"),
            "view_url should point at raw endpoint: {view}"
        );
        assert!(
            view.contains("fixture.pdf"),
            "view_url should include path: {view}"
        );
        assert!(
            opened.binary_base64.is_none(),
            "disk PDF should not embed base64"
        );

        let (raw, mime) = read_raw_file(&dir, "fixture.pdf").expect("raw");
        assert_eq!(mime, "application/pdf");
        assert!(raw.starts_with(b"%PDF"), "raw must start with %PDF");
        assert_eq!(raw, sample_pdf_bytes());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_pdf_bytes_import_uses_base64_without_view_url() {
        let bytes = sample_pdf_bytes();
        let opened = open_bytes("import.pdf", "import.pdf", "pdf", "import", &bytes)
            .expect("open imported pdf");
        assert!(opened.binary);
        assert_eq!(opened.format, "pdf");
        assert!(opened.view_url.is_none());
        let b64 = opened.binary_base64.expect("base64 for non-disk import");
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("decode");
        assert!(decoded.starts_with(b"%PDF"));
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn list_includes_pdf() {
        let dir = std::env::temp_dir().join(format!(
            "cognition-pdf-list-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.pdf"), sample_pdf_bytes()).unwrap();
        let list = list_documents_folder(&dir).unwrap();
        assert!(list.iter().any(|e| e.ext == "pdf" && e.kind == "pdf"));
        let _ = fs::remove_dir_all(&dir);
    }
}

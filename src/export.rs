//! Export document body to md / txt / docx / pdf (local downloads).

use std::io::{Cursor, Write};

use serde::Deserialize;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Deserialize)]
pub struct ExportBody {
    pub format: String,
    pub title: Option<String>,
    pub html: String,
    pub markdown: Option<String>,
}

#[derive(Debug)]
pub struct ExportFile {
    pub filename: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub enum ExportError {
    Unsupported,
    Other(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported => write!(f, "unsupported export format"),
            Self::Other(s) => write!(f, "{s}"),
        }
    }
}

pub fn export_document(body: &ExportBody) -> Result<ExportFile, ExportError> {
    let title = sanitize_filename(body.title.as_deref().unwrap_or("document"));
    let plain = html_to_plain(&body.html);
    match body.format.to_lowercase().as_str() {
        "txt" => Ok(ExportFile {
            filename: format!("{title}.txt"),
            content_type: "text/plain; charset=utf-8".into(),
            bytes: plain.into_bytes(),
        }),
        "md" | "markdown" => {
            let md = body
                .markdown
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| html_to_markdown(&body.html));
            Ok(ExportFile {
                filename: format!("{title}.md"),
                content_type: "text/markdown; charset=utf-8".into(),
                bytes: md.into_bytes(),
            })
        }
        "docx" => {
            let bytes = build_docx(&title, &plain).map_err(ExportError::Other)?;
            Ok(ExportFile {
                filename: format!("{title}.docx"),
                content_type:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        .into(),
                bytes,
            })
        }
        "pdf" => {
            let bytes = build_simple_pdf(&title, &plain).map_err(ExportError::Other)?;
            Ok(ExportFile {
                filename: format!("{title}.pdf"),
                content_type: "application/pdf".into(),
                bytes,
            })
        }
        _ => Err(ExportError::Unsupported),
    }
}

fn sanitize_filename(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let t = t.trim().trim_matches('.');
    if t.is_empty() {
        "document".into()
    } else {
        t.chars().take(80).collect()
    }
}

pub fn html_to_plain(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut entity = String::new();
    let mut in_entity = false;
    for c in html.chars() {
        if in_entity {
            if c == ';' || entity.len() > 12 {
                out.push_str(&decode_entity(&entity));
                entity.clear();
                in_entity = false;
                if c != ';' {
                    // fallthrough handle c
                } else {
                    continue;
                }
            } else {
                entity.push(c);
                continue;
            }
        }
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                // block breaks
                out.push('\n');
            }
            '&' if !in_tag => {
                in_entity = true;
                entity.clear();
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    // collapse whitespace lines
    let mut lines: Vec<String> = out
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines.join("\n\n")
}

fn decode_entity(e: &str) -> String {
    match e {
        "amp" => "&".into(),
        "lt" => "<".into(),
        "gt" => ">".into(),
        "quot" => "\"".into(),
        "nbsp" => " ".into(),
        _ => format!("&{e};"),
    }
}

pub fn html_to_markdown(html: &str) -> String {
    // Very small HTML→MD: headings, bold, italic, lists, links, paragraphs
    let mut s = html.to_string();
    s = s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n");
    s = replace_tag_content(&s, "h1", "# ", "\n\n");
    s = replace_tag_content(&s, "h2", "## ", "\n\n");
    s = replace_tag_content(&s, "h3", "### ", "\n\n");
    s = replace_tag_content(&s, "strong", "**", "**");
    s = replace_tag_content(&s, "b", "**", "**");
    s = replace_tag_content(&s, "em", "*", "*");
    s = replace_tag_content(&s, "i", "*", "*");
    s = replace_tag_content(&s, "code", "`", "`");
    s = replace_tag_content(&s, "li", "- ", "\n");
    s = strip_tags(&s);
    html_to_plain(&s.chars().map(|c| c).collect::<String>())
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn replace_tag_content(html: &str, tag: &str, before: &str, after: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let lower = html.to_lowercase();
    let mut out = String::new();
    let mut i = 0;
    let bytes = html.as_bytes();
    let lower_b = lower.as_bytes();
    while i < bytes.len() {
        if let Some(rel) = find_subslice(&lower_b[i..], open.as_bytes()) {
            let start = i + rel;
            out.push_str(&html[i..start]);
            // find end of open tag
            let after_open = match html[start..].find('>') {
                Some(p) => start + p + 1,
                None => {
                    out.push_str(&html[start..]);
                    break;
                }
            };
            if let Some(rel2) = find_subslice(&lower_b[after_open..], close.as_bytes()) {
                let content_end = after_open + rel2;
                let content = &html[after_open..content_end];
                out.push_str(before);
                out.push_str(content);
                out.push_str(after);
                i = content_end + close.len();
                continue;
            } else {
                out.push_str(&html[start..after_open]);
                i = after_open;
                continue;
            }
        }
        out.push_str(&html[i..]);
        break;
    }
    out
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn build_docx(title: &str, plain: &str) -> Result<Vec<u8>, String> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buf);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

        zip.start_file("[Content_Types].xml", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
        )
        .map_err(|e| e.to_string())?;

        zip.start_file("_rels/.rels", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
        )
        .map_err(|e| e.to_string())?;

        zip.start_file("word/document.xml", opts)
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        body.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        body.push_str(
            r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
        );
        // title paragraph
        body.push_str(&format!(
            "<w:p><w:r><w:t>{}</w:t></w:r></w:p>",
            xml_escape(title)
        ));
        for para in plain.split("\n\n") {
            body.push_str("<w:p><w:r><w:t xml:space=\"preserve\">");
            body.push_str(&xml_escape(&para.replace('\n', " ")));
            body.push_str("</w:t></w:r></w:p>");
        }
        body.push_str(r#"<w:sectPr/></w:body></w:document>"#);
        zip.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf.into_inner())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Minimal multi-line text PDF (Type1 Helvetica-like via built-in PDF fonts).
fn build_simple_pdf(title: &str, plain: &str) -> Result<Vec<u8>, String> {
    let mut lines: Vec<String> = Vec::new();
    lines.push(title.to_string());
    lines.push(String::new());
    for para in plain.split("\n\n") {
        // wrap ~90 chars
        let words: Vec<&str> = para.split_whitespace().collect();
        let mut cur = String::new();
        for w in words {
            if cur.len() + w.len() + 1 > 90 {
                lines.push(cur);
                cur = w.to_string();
            } else {
                if !cur.is_empty() {
                    cur.push(' ');
                }
                cur.push_str(w);
            }
        }
        if !cur.is_empty() {
            lines.push(cur);
        }
        lines.push(String::new());
    }
    if lines.len() > 60 {
        lines.truncate(60);
        lines.push("…".into());
    }

    // Build PDF content stream
    let mut content = String::from("BT\n/F1 12 Tf\n14 TL\n50 780 Td\n");
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            content.push_str("T*\n");
        }
        content.push_str(&format!("({}) Tj\n", pdf_escape(line)));
    }
    content.push_str("ET");

    let content_bytes = content.as_bytes();
    let mut pdf = Vec::new();
    let mut offsets = Vec::new();

    fn write_obj(pdf: &mut Vec<u8>, offsets: &mut Vec<usize>, n: usize, body: &[u8]) {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{n} 0 obj\n").as_bytes());
        pdf.extend_from_slice(body);
        if !body.ends_with(b"\n") {
            pdf.push(b'\n');
        }
        pdf.extend_from_slice(b"endobj\n");
    }

    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    write_obj(
        &mut pdf,
        &mut offsets,
        1,
        b"<< /Type /Catalog /Pages 2 0 R >>",
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        2,
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        3,
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    );
    let stream = format!(
        "<< /Length {} >>\nstream\n{}\nendstream",
        content_bytes.len(),
        content
    );
    write_obj(&mut pdf, &mut offsets, 4, stream.as_bytes());
    write_obj(
        &mut pdf,
        &mut offsets,
        5,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    );

    let xref_pos = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", offsets.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for off in &offsets {
        pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            offsets.len() + 1,
            xref_pos
        )
        .as_bytes(),
    );
    Ok(pdf)
}

fn pdf_escape(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\\' => "\\\\".into(),
            '(' => "\\(".into(),
            ')' => "\\)".into(),
            c if c.is_ascii() && !c.is_control() => c.to_string(),
            _ => " ".into(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_strips_tags() {
        let p = html_to_plain("<p>Hi <b>there</b></p>");
        assert!(p.contains("Hi"));
        assert!(p.contains("there"));
    }

    #[test]
    fn pdf_builds() {
        let b = build_simple_pdf("T", "Hello world").unwrap();
        assert!(b.starts_with(b"%PDF"));
    }
}

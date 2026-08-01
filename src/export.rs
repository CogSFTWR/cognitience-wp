//! Export document body to md / txt / docx / pdf (local downloads).
//! PDF and DOCX preserve rich text: bold, italic, underline, headings, and lists.

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
            let doc = parse_html_document(&body.html);
            let bytes = build_docx(&title, &doc).map_err(ExportError::Other)?;
            Ok(ExportFile {
                filename: format!("{title}.docx"),
                content_type:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        .into(),
                bytes,
            })
        }
        "pdf" => {
            let doc = parse_html_document(&body.html);
            let bytes = build_rich_pdf(&title, &doc).map_err(ExportError::Other)?;
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

// ── Rich document model ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
struct TextRun {
    text: String,
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Debug, Clone)]
enum Block {
    Heading { level: u8, runs: Vec<TextRun> },
    Paragraph { runs: Vec<TextRun> },
    List { ordered: bool, items: Vec<Vec<TextRun>> },
}

#[derive(Debug, Clone, Default)]
struct RichDoc {
    blocks: Vec<Block>,
}

#[derive(Clone, Copy, Default)]
struct InlineStyle {
    bold: bool,
    italic: bool,
    underline: bool,
}

fn parse_html_document(html: &str) -> RichDoc {
    let tokens = tokenize_html(html);
    let mut blocks: Vec<Block> = Vec::new();
    let mut i = 0;
    let mut list_stack: Vec<(bool, Vec<Vec<TextRun>>)> = Vec::new();

    while i < tokens.len() {
        match &tokens[i] {
            HtmlToken::Open { name, .. } => {
                let tag = name.as_str();
                match tag {
                    "ul" | "ol" => {
                        list_stack.push((tag == "ol", Vec::new()));
                        i += 1;
                    }
                    "li" => {
                        let (runs, next) = collect_inline_until(&tokens, i + 1, &["li"]);
                        if let Some((_, items)) = list_stack.last_mut() {
                            items.push(collapse_runs(runs));
                        } else {
                            // Orphan li → paragraph with bullet prefix
                            let mut prefixed = vec![TextRun {
                                text: "• ".into(),
                                ..Default::default()
                            }];
                            prefixed.extend(collapse_runs(runs));
                            blocks.push(Block::Paragraph { runs: prefixed });
                        }
                        i = next;
                    }
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        flush_lists(&mut blocks, &mut list_stack);
                        let level = tag.as_bytes()[1] - b'0';
                        let (runs, next) = collect_inline_until(&tokens, i + 1, &[tag]);
                        let runs = collapse_runs(runs);
                        if !runs_are_empty(&runs) {
                            blocks.push(Block::Heading { level, runs });
                        }
                        i = next;
                    }
                    "p" | "div" | "blockquote" => {
                        flush_lists(&mut blocks, &mut list_stack);
                        let (runs, next) = collect_inline_until(&tokens, i + 1, &[tag]);
                        let runs = collapse_runs(runs);
                        if !runs_are_empty(&runs) {
                            blocks.push(Block::Paragraph { runs });
                        }
                        i = next;
                    }
                    "br" => {
                        // Standalone br between blocks → blank paragraph break
                        if list_stack.is_empty() {
                            blocks.push(Block::Paragraph {
                                runs: vec![TextRun::default()],
                            });
                        }
                        i += 1;
                    }
                    "script" | "style" => {
                        i = skip_until_close(&tokens, i + 1, tag);
                    }
                    _ => {
                        // Treat unknown open as inline container start; walk children later via collect
                        // For top-level unknown tags, collect their content as a paragraph.
                        if list_stack.is_empty()
                            && matches!(
                                tag,
                                "span"
                                    | "strong"
                                    | "b"
                                    | "em"
                                    | "i"
                                    | "u"
                                    | "a"
                                    | "code"
                                    | "font"
                            )
                        {
                            let (runs, next) = collect_inline_from(&tokens, i, InlineStyle::default());
                            let runs = collapse_runs(runs);
                            if !runs_are_empty(&runs) {
                                blocks.push(Block::Paragraph { runs });
                            }
                            i = next;
                        } else {
                            i += 1;
                        }
                    }
                }
            }
            HtmlToken::Close { name } => {
                if (name == "ul" || name == "ol") && !list_stack.is_empty() {
                    if let Some((ordered, items)) = list_stack.pop() {
                        if !items.is_empty() {
                            blocks.push(Block::List { ordered, items });
                        }
                    }
                }
                i += 1;
            }
            HtmlToken::Text(t) => {
                let trimmed = t.trim();
                if !trimmed.is_empty() && list_stack.is_empty() {
                    blocks.push(Block::Paragraph {
                        runs: vec![TextRun {
                            text: decode_entities(trimmed),
                            ..Default::default()
                        }],
                    });
                }
                i += 1;
            }
            HtmlToken::SelfClose { .. } => i += 1,
        }
    }
    flush_lists(&mut blocks, &mut list_stack);

    if blocks.is_empty() {
        blocks.push(Block::Paragraph {
            runs: vec![TextRun::default()],
        });
    }
    RichDoc { blocks }
}

fn flush_lists(blocks: &mut Vec<Block>, list_stack: &mut Vec<(bool, Vec<Vec<TextRun>>)>) {
    while let Some((ordered, items)) = list_stack.pop() {
        if !items.is_empty() {
            blocks.push(Block::List { ordered, items });
        }
    }
}

fn runs_are_empty(runs: &[TextRun]) -> bool {
    runs.iter().all(|r| r.text.trim().is_empty())
}

fn collapse_runs(runs: Vec<TextRun>) -> Vec<TextRun> {
    let mut out: Vec<TextRun> = Vec::new();
    for r in runs {
        if r.text.is_empty() {
            continue;
        }
        if let Some(last) = out.last_mut() {
            if last.bold == r.bold && last.italic == r.italic && last.underline == r.underline {
                last.text.push_str(&r.text);
                continue;
            }
        }
        out.push(r);
    }
    if out.is_empty() {
        out.push(TextRun::default());
    }
    out
}

fn collect_inline_until<'a>(
    tokens: &'a [HtmlToken],
    start: usize,
    close_tags: &[&str],
) -> (Vec<TextRun>, usize) {
    let mut runs = Vec::new();
    let mut i = start;
    let mut depth: Vec<&str> = Vec::new();
    while i < tokens.len() {
        match &tokens[i] {
            HtmlToken::Close { name } => {
                if depth.is_empty() && close_tags.iter().any(|t| t.eq_ignore_ascii_case(name)) {
                    return (runs, i + 1);
                }
                if depth.last().copied() == Some(name.as_str()) {
                    depth.pop();
                }
                i += 1;
            }
            HtmlToken::Open { name, .. } if is_block_tag(name) => {
                // Stop before nested block (except handled specially)
                if depth.is_empty() {
                    return (runs, i);
                }
                i += 1;
            }
            _ => {
                let (chunk, next) = collect_inline_from(tokens, i, InlineStyle::default());
                runs.extend(chunk);
                if next == i {
                    i += 1;
                } else {
                    i = next;
                }
            }
        }
    }
    (runs, i)
}

fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "ul"
            | "ol"
            | "li"
            | "table"
            | "tr"
            | "td"
            | "th"
            | "blockquote"
            | "section"
            | "article"
            | "header"
            | "footer"
    )
}

fn collect_inline_from(
    tokens: &[HtmlToken],
    start: usize,
    style: InlineStyle,
) -> (Vec<TextRun>, usize) {
    let mut runs = Vec::new();
    let mut i = start;
    if i >= tokens.len() {
        return (runs, i);
    }
    match &tokens[i] {
        HtmlToken::Text(t) => {
            let text = decode_entities(t);
            if !text.is_empty() {
                runs.push(TextRun {
                    text,
                    bold: style.bold,
                    italic: style.italic,
                    underline: style.underline,
                });
            }
            (runs, i + 1)
        }
        HtmlToken::SelfClose { name } if name == "br" => {
            runs.push(TextRun {
                text: "\n".into(),
                bold: style.bold,
                italic: style.italic,
                underline: style.underline,
            });
            (runs, i + 1)
        }
        HtmlToken::Open { name, attrs } => {
            let tag = name.as_str();
            if is_block_tag(tag) && tag != "li" {
                return (runs, i);
            }
            let mut next_style = style;
            match tag {
                "b" | "strong" => next_style.bold = true,
                "i" | "em" => next_style.italic = true,
                "u" => next_style.underline = true,
                "span" | "font" => {
                    apply_css_style(attrs, &mut next_style);
                }
                "br" => {
                    runs.push(TextRun {
                        text: "\n".into(),
                        ..style_to_run(style)
                    });
                    return (runs, i + 1);
                }
                _ => {}
            }
            i += 1;
            while i < tokens.len() {
                if let HtmlToken::Close { name } = &tokens[i] {
                    if name == tag {
                        return (runs, i + 1);
                    }
                }
                if let HtmlToken::Open { name, .. } = &tokens[i] {
                    if is_block_tag(name) {
                        return (runs, i);
                    }
                }
                let (chunk, next) = collect_inline_from(tokens, i, next_style);
                runs.extend(chunk);
                if next == i {
                    i += 1;
                } else {
                    i = next;
                }
            }
            (runs, i)
        }
        HtmlToken::Close { .. } => (runs, i),
        HtmlToken::SelfClose { .. } => (runs, i + 1),
    }
}

fn style_to_run(style: InlineStyle) -> TextRun {
    TextRun {
        text: String::new(),
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
    }
}

fn apply_css_style(attrs: &str, style: &mut InlineStyle) {
    let lower = attrs.to_lowercase();
    if let Some(idx) = lower.find("style=") {
        let rest = &attrs[idx + 6..];
        let style_val = extract_attr_value(rest).unwrap_or_default();
        let sl = style_val.to_lowercase();
        if sl.contains("font-weight:bold")
            || sl.contains("font-weight: bold")
            || sl.contains("font-weight:700")
            || sl.contains("font-weight: 700")
        {
            style.bold = true;
        }
        if sl.contains("font-style:italic") || sl.contains("font-style: italic") {
            style.italic = true;
        }
        if sl.contains("underline") {
            style.underline = true;
        }
    }
}

fn extract_attr_value(s: &str) -> Option<String> {
    let s = s.trim_start();
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let quote = bytes[0];
    if quote == b'"' || quote == b'\'' {
        let end = s[1..].find(quote as char)?;
        Some(s[1..1 + end].to_string())
    } else {
        let end = s.find(|c: char| c.is_whitespace() || c == '>').unwrap_or(s.len());
        Some(s[..end].to_string())
    }
}

fn skip_until_close(tokens: &[HtmlToken], start: usize, tag: &str) -> usize {
    let mut i = start;
    while i < tokens.len() {
        if let HtmlToken::Close { name } = &tokens[i] {
            if name == tag {
                return i + 1;
            }
        }
        i += 1;
    }
    i
}

// ── HTML tokenizer ───────────────────────────────────────────────────────────

#[derive(Debug)]
enum HtmlToken {
    Open { name: String, attrs: String },
    Close { name: String },
    SelfClose { name: String },
    Text(String),
}

fn tokenize_html(html: &str) -> Vec<HtmlToken> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = html.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '<' {
            let start = i;
            i += 1;
            if i < chars.len() && chars[i] == '!' {
                // comment or doctype
                if chars.get(i..i + 3) == Some(&['!', '-', '-']) {
                    i += 3;
                    while i + 2 < chars.len()
                        && !(chars[i] == '-' && chars[i + 1] == '-' && chars[i + 2] == '>')
                    {
                        i += 1;
                    }
                    i = (i + 3).min(chars.len());
                } else {
                    while i < chars.len() && chars[i] != '>' {
                        i += 1;
                    }
                    if i < chars.len() {
                        i += 1;
                    }
                }
                continue;
            }
            let closing = i < chars.len() && chars[i] == '/';
            if closing {
                i += 1;
            }
            let name_start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '-') {
                i += 1;
            }
            let name: String = chars[name_start..i].iter().collect::<String>().to_lowercase();
            while i < chars.len() && chars[i] != '>' {
                i += 1;
            }
            let raw: String = chars[start..i.min(chars.len())].iter().collect();
            let self_closing = raw.trim_end().ends_with("/>")
                || matches!(name.as_str(), "br" | "hr" | "img" | "meta" | "input");
            if i < chars.len() {
                i += 1;
            }
            if name.is_empty() {
                continue;
            }
            if closing {
                tokens.push(HtmlToken::Close { name });
            } else if self_closing {
                tokens.push(HtmlToken::SelfClose { name });
            } else {
                let attrs = if let Some(sp) = raw.find(|c: char| c.is_whitespace()) {
                    let rest = &raw[sp..];
                    rest.trim_start()
                        .trim_end_matches('>')
                        .trim_end_matches('/')
                        .trim()
                        .to_string()
                } else {
                    String::new()
                };
                tokens.push(HtmlToken::Open { name, attrs });
            }
        } else {
            let start = i;
            while i < chars.len() && chars[i] != '<' {
                i += 1;
            }
            let text: String = chars[start..i].iter().collect();
            if !text.is_empty() {
                tokens.push(HtmlToken::Text(text));
            }
        }
    }
    tokens
}

fn decode_entities(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '&' {
            let mut ent = String::new();
            while let Some(&n) = chars.peek() {
                if n == ';' || ent.len() > 12 {
                    break;
                }
                ent.push(n);
                chars.next();
            }
            if chars.peek() == Some(&';') {
                chars.next();
                out.push_str(&decode_entity(&ent));
            } else {
                out.push('&');
                out.push_str(&ent);
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn html_to_plain(html: &str) -> String {
    let doc = parse_html_document(html);
    let mut lines: Vec<String> = Vec::new();
    for block in &doc.blocks {
        match block {
            Block::Heading { runs, .. } | Block::Paragraph { runs } => {
                let t = runs_to_plain(runs);
                if !t.trim().is_empty() {
                    lines.push(t);
                }
            }
            Block::List { ordered, items } => {
                for (idx, item) in items.iter().enumerate() {
                    let prefix = if *ordered {
                        format!("{}. ", idx + 1)
                    } else {
                        "- ".into()
                    };
                    lines.push(format!("{}{}", prefix, runs_to_plain(item)));
                }
            }
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines.join("\n\n")
}

fn runs_to_plain(runs: &[TextRun]) -> String {
    runs.iter()
        .map(|r| r.text.replace('\n', " "))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_entity(e: &str) -> String {
    match e {
        "amp" => "&".into(),
        "lt" => "<".into(),
        "gt" => ">".into(),
        "quot" => "\"".into(),
        "nbsp" => " ".into(),
        "apos" => "'".into(),
        _ => format!("&{e};"),
    }
}

pub fn html_to_markdown(html: &str) -> String {
    let doc = parse_html_document(html);
    let mut out = String::new();
    for block in &doc.blocks {
        match block {
            Block::Heading { level, runs } => {
                let hashes = "#".repeat((*level).min(6) as usize);
                out.push_str(&format!(
                    "{} {}\n\n",
                    hashes,
                    runs_to_markdown(runs)
                ));
            }
            Block::Paragraph { runs } => {
                let t = runs_to_markdown(runs);
                if !t.trim().is_empty() {
                    out.push_str(&t);
                    out.push_str("\n\n");
                }
            }
            Block::List { ordered, items } => {
                for (idx, item) in items.iter().enumerate() {
                    if *ordered {
                        out.push_str(&format!("{}. {}\n", idx + 1, runs_to_markdown(item)));
                    } else {
                        out.push_str(&format!("- {}\n", runs_to_markdown(item)));
                    }
                }
                out.push('\n');
            }
        }
    }
    out.trim().to_string()
}

fn runs_to_markdown(runs: &[TextRun]) -> String {
    let mut s = String::new();
    for r in runs {
        let mut t = r.text.replace('\n', " ");
        if r.bold && r.italic {
            t = format!("***{t}***");
        } else if r.bold {
            t = format!("**{t}**");
        } else if r.italic {
            t = format!("*{t}*");
        }
        s.push_str(&t);
    }
    s.trim().to_string()
}

// ── DOCX builder ─────────────────────────────────────────────────────────────

fn build_docx(title: &str, doc: &RichDoc) -> Result<Vec<u8>, String> {
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
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
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

        zip.start_file("word/_rels/document.xml.rels", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>"#,
        )
        .map_err(|e| e.to_string())?;

        zip.start_file("word/numbering.xml", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(DOCX_NUMBERING.as_bytes())
            .map_err(|e| e.to_string())?;

        zip.start_file("word/document.xml", opts)
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        body.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#);
        body.push_str(
            r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#,
        );
        // Title
        body.push_str(&format!(
            "<w:p><w:pPr><w:pStyle w:val=\"Title\"/><w:spacing w:after=\"200\"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr><w:t>{}</w:t></w:r></w:p>",
            xml_escape(title)
        ));

        for block in &doc.blocks {
            match block {
                Block::Heading { level, runs } => {
                    let sz = match level {
                        1 => 36,
                        2 => 32,
                        3 => 28,
                        _ => 24,
                    };
                    body.push_str("<w:p><w:pPr><w:spacing w:before=\"240\" w:after=\"120\"/></w:pPr>");
                    body.push_str(&docx_runs(runs, true, sz));
                    body.push_str("</w:p>");
                }
                Block::Paragraph { runs } => {
                    body.push_str("<w:p><w:pPr><w:spacing w:after=\"120\"/></w:pPr>");
                    body.push_str(&docx_runs(runs, false, 24));
                    body.push_str("</w:p>");
                }
                Block::List { ordered, items } => {
                    let num_id = if *ordered { 2 } else { 1 };
                    for item in items {
                        body.push_str(&format!(
                            "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"{num_id}\"/></w:numPr><w:spacing w:after=\"60\"/></w:pPr>"
                        ));
                        body.push_str(&docx_runs(item, false, 24));
                        body.push_str("</w:p>");
                    }
                }
            }
        }
        body.push_str(r#"<w:sectPr/></w:body></w:document>"#);
        zip.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf.into_inner())
}

const DOCX_NUMBERING: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"#;

fn docx_runs(runs: &[TextRun], force_bold: bool, sz_half_points: u32) -> String {
    let mut out = String::new();
    for r in runs {
        // Split on soft line breaks
        let parts: Vec<&str> = r.text.split('\n').collect();
        for (pi, part) in parts.iter().enumerate() {
            if pi > 0 {
                out.push_str("<w:r><w:br/></w:r>");
            }
            if part.is_empty() {
                continue;
            }
            out.push_str("<w:r><w:rPr>");
            if force_bold || r.bold {
                out.push_str("<w:b/>");
            }
            if r.italic {
                out.push_str("<w:i/>");
            }
            if r.underline {
                out.push_str(r#"<w:u w:val="single"/>"#);
            }
            out.push_str(&format!(r#"<w:sz w:val="{sz_half_points}"/><w:szCs w:val="{sz_half_points}"/>"#));
            out.push_str("</w:rPr>");
            let preserve = part.starts_with(' ') || part.ends_with(' ');
            if preserve {
                out.push_str(r#"<w:t xml:space="preserve">"#);
            } else {
                out.push_str("<w:t>");
            }
            out.push_str(&xml_escape(part));
            out.push_str("</w:t></w:r>");
        }
    }
    if out.is_empty() {
        out.push_str("<w:r><w:t></w:t></w:r>");
    }
    out
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ── Rich PDF builder ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct PdfSpan {
    text: String,
    bold: bool,
    italic: bool,
    underline: bool,
    size: f64,
}

#[derive(Clone)]
struct PdfLine {
    spans: Vec<PdfSpan>,
    indent: f64,
}

fn build_rich_pdf(title: &str, doc: &RichDoc) -> Result<Vec<u8>, String> {
    let mut lines: Vec<PdfLine> = Vec::new();
    // Title
    lines.push(PdfLine {
        spans: vec![PdfSpan {
            text: title.to_string(),
            bold: true,
            italic: false,
            underline: false,
            size: 18.0,
        }],
        indent: 0.0,
    });
    lines.push(PdfLine {
        spans: vec![],
        indent: 0.0,
    });

    for block in &doc.blocks {
        match block {
            Block::Heading { level, runs } => {
                let size = match level {
                    1 => 16.0,
                    2 => 14.0,
                    _ => 13.0,
                };
                lines.extend(wrap_runs(runs, size, true, 0.0, 90));
                lines.push(PdfLine {
                    spans: vec![],
                    indent: 0.0,
                });
            }
            Block::Paragraph { runs } => {
                lines.extend(wrap_runs(runs, 12.0, false, 0.0, 90));
                lines.push(PdfLine {
                    spans: vec![],
                    indent: 0.0,
                });
            }
            Block::List { ordered, items } => {
                for (idx, item) in items.iter().enumerate() {
                    let marker = if *ordered {
                        format!("{}. ", idx + 1)
                    } else {
                        // ASCII-safe for built-in Helvetica (U+2022 is not in WinAnsi)
                        "- ".into()
                    };
                    let mut with_marker = vec![TextRun {
                        text: marker,
                        ..Default::default()
                    }];
                    with_marker.extend(item.iter().cloned());
                    lines.extend(wrap_runs(&with_marker, 12.0, false, 18.0, 85));
                }
                lines.push(PdfLine {
                    spans: vec![],
                    indent: 0.0,
                });
            }
        }
    }

    // Paginate (~50 lines per page at 14pt leading)
    const PAGE_H: f64 = 792.0;
    const MARGIN_TOP: f64 = 50.0;
    const MARGIN_BOTTOM: f64 = 50.0;
    const LEADING: f64 = 16.0;
    let max_lines = ((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / LEADING) as usize;

    let mut pages: Vec<Vec<PdfLine>> = Vec::new();
    let mut cur: Vec<PdfLine> = Vec::new();
    for line in lines {
        if cur.len() >= max_lines {
            pages.push(std::mem::take(&mut cur));
        }
        cur.push(line);
    }
    if cur.is_empty() && pages.is_empty() {
        cur.push(PdfLine {
            spans: vec![],
            indent: 0.0,
        });
    }
    if !cur.is_empty() {
        pages.push(cur);
    }

    // Fonts: F1 Helvetica, F2 Bold, F3 Oblique, F4 BoldOblique
    let mut content_streams: Vec<Vec<u8>> = Vec::new();
    for page_lines in &pages {
        let mut content = String::from("BT\n");
        let mut y = PAGE_H - MARGIN_TOP;
        let mut first = true;
        for line in page_lines {
            if !first {
                // move down
            }
            first = false;
            let x = 50.0 + line.indent;
            if line.spans.is_empty() {
                y -= LEADING;
                continue;
            }
            let size = line.spans.first().map(|s| s.size).unwrap_or(12.0);
            content.push_str(&format!("1 0 0 1 {x:.2} {y:.2} Tm\n"));
            let mut underline_segments: Vec<(f64, f64)> = Vec::new();
            let mut adv = 0.0_f64;
            for span in &line.spans {
                let font = match (span.bold, span.italic) {
                    (true, true) => "/F4",
                    (true, false) => "/F2",
                    (false, true) => "/F3",
                    (false, false) => "/F1",
                };
                let sz = span.size;
                content.push_str(&format!("{font} {sz:.1} Tf\n"));
                content.push_str(&format!("({}) Tj\n", pdf_escape(&span.text)));
                let w = approx_text_width(&span.text, sz);
                if span.underline && !span.text.trim().is_empty() {
                    underline_segments.push((x + adv, w));
                }
                adv += w;
            }
            y -= LEADING.max(size + 4.0);
            if !underline_segments.is_empty() {
                content.push_str("ET\n");
                for (ux, uw) in underline_segments {
                    content.push_str(&format!(
                        "q\n0.6 w\n{ux:.2} {uy:.2} m\n{ex:.2} {uy:.2} l\nS\nQ\n",
                        uy = y + LEADING.max(size + 4.0) - 2.0,
                        ex = ux + uw
                    ));
                }
                content.push_str("BT\n");
            }
        }
        content.push_str("ET\n");
        content_streams.push(content.into_bytes());
    }

    // Build PDF with N pages
    let mut pdf = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();

    fn write_obj(pdf: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]) -> usize {
        offsets.push(pdf.len());
        let n = offsets.len();
        pdf.extend_from_slice(format!("{n} 0 obj\n").as_bytes());
        pdf.extend_from_slice(body);
        if !body.ends_with(b"\n") {
            pdf.push(b'\n');
        }
        pdf.extend_from_slice(b"endobj\n");
        n
    }

    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    // Object 1: Catalog
    write_obj(
        &mut pdf,
        &mut offsets,
        b"<< /Type /Catalog /Pages 2 0 R >>",
    );

    // We'll fill Pages (obj 2) after we know kids
    // Reserve: obj 2 = Pages, then fonts 3-6, then content+page pairs
    let font_f1 = 3;
    let font_f2 = 4;
    let font_f3 = 5;
    let font_f4 = 6;
    // Pre-write placeholder for pages - actually write fonts first after pages kids known

    // Compute object numbers:
    // 1 Catalog, 2 Pages, 3-6 Fonts, then for each page: content stream, page obj
    let first_page_obj = 7;
    let mut page_objs = Vec::new();
    let mut content_objs = Vec::new();
    for i in 0..content_streams.len() {
        let content_obj = first_page_obj + i * 2;
        let page_obj = content_obj + 1;
        content_objs.push(content_obj);
        page_objs.push(page_obj);
    }

    let kids: String = page_objs
        .iter()
        .map(|n| format!("{n} 0 R"))
        .collect::<Vec<_>>()
        .join(" ");
    // Obj 2 pages - but we need to write in order. Rebuild properly:

    // Reset and write in order
    pdf.clear();
    offsets.clear();
    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    write_obj(
        &mut pdf,
        &mut offsets,
        b"<< /Type /Catalog /Pages 2 0 R >>",
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids,
            page_objs.len()
        )
        .as_bytes(),
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>",
    );
    write_obj(
        &mut pdf,
        &mut offsets,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>",
    );

    for (i, stream) in content_streams.iter().enumerate() {
        let stream_obj = format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            stream.len(),
            String::from_utf8_lossy(stream)
        );
        let cobj = write_obj(&mut pdf, &mut offsets, stream_obj.as_bytes());
        assert_eq!(cobj, content_objs[i]);
        let page_body = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {cobj} 0 R \
             /Resources << /Font << /F1 {font_f1} 0 R /F2 {font_f2} 0 R /F3 {font_f3} 0 R /F4 {font_f4} 0 R >> >> >>"
        );
        let pobj = write_obj(&mut pdf, &mut offsets, page_body.as_bytes());
        assert_eq!(pobj, page_objs[i]);
    }

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

fn approx_text_width(text: &str, size: f64) -> f64 {
    // Helvetica average char width ~0.5 em
    text.chars().count() as f64 * size * 0.5
}

fn wrap_runs(
    runs: &[TextRun],
    size: f64,
    force_bold: bool,
    indent: f64,
    max_chars: usize,
) -> Vec<PdfLine> {
    // Flatten to words preserving style
    struct Word {
        text: String,
        bold: bool,
        italic: bool,
        underline: bool,
    }
    let mut words: Vec<Word> = Vec::new();
    for r in runs {
        let bold = force_bold || r.bold;
        for (li, line_part) in r.text.split('\n').enumerate() {
            if li > 0 {
                words.push(Word {
                    text: "\n".into(),
                    bold,
                    italic: r.italic,
                    underline: r.underline,
                });
            }
            for w in line_part.split_whitespace() {
                words.push(Word {
                    text: w.to_string(),
                    bold,
                    italic: r.italic,
                    underline: r.underline,
                });
            }
        }
    }

    let mut lines: Vec<PdfLine> = Vec::new();
    let mut cur_spans: Vec<PdfSpan> = Vec::new();
    let mut cur_len = 0usize;

    let flush = |spans: &mut Vec<PdfSpan>, lines: &mut Vec<PdfLine>| {
        if !spans.is_empty() {
            lines.push(PdfLine {
                spans: std::mem::take(spans),
                indent,
            });
        }
    };

    for w in words {
        if w.text == "\n" {
            flush(&mut cur_spans, &mut lines);
            cur_len = 0;
            continue;
        }
        let add_len = w.text.len() + if cur_len > 0 { 1 } else { 0 };
        if cur_len > 0 && cur_len + add_len > max_chars {
            flush(&mut cur_spans, &mut lines);
            cur_len = 0;
        }
        let prefix = if cur_len > 0 { " " } else { "" };
        let text = format!("{prefix}{}", w.text);
        cur_len += text.len();
        if let Some(last) = cur_spans.last_mut() {
            if last.bold == w.bold
                && last.italic == w.italic
                && last.underline == w.underline
                && (last.size - size).abs() < f64::EPSILON
            {
                last.text.push_str(&text);
                continue;
            }
        }
        cur_spans.push(PdfSpan {
            text,
            bold: w.bold,
            italic: w.italic,
            underline: w.underline,
            size,
        });
    }
    flush(&mut cur_spans, &mut lines);
    if lines.is_empty() {
        lines.push(PdfLine {
            spans: vec![],
            indent,
        });
    }
    lines
}

fn pdf_escape(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\\' => "\\\\".into(),
            '(' => "\\(".into(),
            ')' => "\\)".into(),
            c if c.is_ascii() && !c.is_control() => c.to_string(),
            // Latin-1 via octal for common accents; else space
            c => {
                let u = c as u32;
                if u < 256 {
                    format!("\\{u:03o}")
                } else {
                    " ".to_string()
                }
            }
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
    fn plain_preserves_list_markers() {
        let p = html_to_plain("<ul><li>One</li><li>Two</li></ul>");
        assert!(p.contains("- One"));
        assert!(p.contains("- Two"));
    }

    #[test]
    fn markdown_preserves_bold() {
        let md = html_to_markdown("<p>Hi <strong>there</strong></p>");
        assert!(md.contains("**there**"), "got: {md}");
    }

    #[test]
    fn docx_contains_bold_run() {
        let doc = parse_html_document("<p>Hi <b>there</b> friend</p>");
        let bytes = build_docx("Doc", &doc).unwrap();
        // docx is a zip; search for <w:b/> in uncompressed stored entries
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("<w:b/>") || bytes.windows(6).any(|w| w == b"<w:b/>"));
        assert!(bytes.windows(4).any(|w| w == b"PK\x03\x04"));
    }

    #[test]
    fn docx_lists_use_numbering() {
        let doc = parse_html_document("<ol><li>First</li><li>Second</li></ol>");
        let bytes = build_docx("Doc", &doc).unwrap();
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("numId") || bytes.windows(5).any(|w| w == b"numId"));
        assert!(s.contains("First") || bytes.windows(5).any(|w| w == b"First"));
    }

    #[test]
    fn pdf_builds_rich() {
        let doc = parse_html_document(
            "<h1>Title</h1><p>Hello <b>bold</b> and <i>italic</i></p><ul><li>Item</li></ul>",
        );
        let b = build_rich_pdf("T", &doc).unwrap();
        assert!(b.starts_with(b"%PDF"));
        assert!(b.windows(14).any(|w| w == b"Helvetica-Bold"));
    }

    #[test]
    fn pdf_builds_plain_compat() {
        let doc = parse_html_document("<p>Hello world</p>");
        let b = build_rich_pdf("T", &doc).unwrap();
        assert!(b.starts_with(b"%PDF"));
    }

    #[test]
    fn parse_nested_formatting() {
        let doc = parse_html_document("<p><strong>Bold <em>and italic</em></strong></p>");
        match &doc.blocks[0] {
            Block::Paragraph { runs } => {
                assert!(runs.iter().any(|r| r.bold && r.text.contains("Bold")));
                assert!(runs.iter().any(|r| r.bold && r.italic));
            }
            _ => panic!("expected paragraph"),
        }
    }
}

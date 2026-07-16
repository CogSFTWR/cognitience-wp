/**
 * Cognitience WP — Export Manager
 * Handles exporting documents to multiple formats: .cog, .md, .txt, .pdf, .docx, .doc (RTF), .html
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { COGNITIENCE_DOC_FORMAT, APP_VERSION } from '../shared/constants';

export class ExportManager {
  constructor() {
    this.registerIPC();
  }

  private registerIPC() {
    ipcMain.handle('export:document', async (_, data: ExportRequest) => {
      return this.exportDocument(data);
    });
  }

  async exportDocument(data: ExportRequest): Promise<{ success: boolean; filePath: string | null; error?: string }> {
    const { format, content, title, window } = data;

    // Show save dialog
    const filters = this.getFilters(format);
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || undefined!, {
      title: `Export as ${format.toUpperCase()}`,
      defaultPath: title || 'Untitled',
      filters,
    });

    if (result.canceled || !result.filePath) {
      return { success: false, filePath: null };
    }

    const filePath = result.filePath;

    try {
      switch (format) {
        case 'cog':
          this.exportCog(filePath, content, title);
          break;
        case 'markdown':
        case 'md':
          this.exportMarkdown(filePath, content);
          break;
        case 'txt':
        case 'plaintext':
          this.exportText(filePath, content);
          break;
        case 'html':
          this.exportHtml(filePath, content, title);
          break;
        case 'pdf':
          await this.exportPdf(filePath, content, title, window);
          break;
        case 'docx':
          await this.exportDocx(filePath, content, title);
          break;
        case 'doc':
          this.exportDoc(filePath, content, title);
          break;
        default:
          return { success: false, filePath: null, error: `Unknown format: ${format}` };
      }

      return { success: true, filePath };
    } catch (err) {
      return { success: false, filePath: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private getFilters(format: string): Electron.FileFilter[] {
    switch (format) {
      case 'cog': return [{ name: 'Cognitience Document', extensions: ['cog'] }];
      case 'markdown': case 'md': return [{ name: 'Markdown', extensions: ['md'] }];
      case 'txt': case 'plaintext': return [{ name: 'Plain Text', extensions: ['txt'] }];
      case 'html': return [{ name: 'HTML', extensions: ['html'] }];
      case 'pdf': return [{ name: 'PDF', extensions: ['pdf'] }];
      case 'docx': return [{ name: 'Word Document', extensions: ['docx'] }];
      case 'doc': return [{ name: 'Word 97-2003 Document', extensions: ['doc'] }];
      default: return [{ name: 'All Files', extensions: ['*'] }];
    }
  }

  // ─── .cog Format (v3.0.0) ───────────────────────────────
  // Markdown body with YAML frontmatter — readable by humans and AI agents.
  //
  // File layout:
  //   ---
  //   magic: COGWP
  //   version: 3.0.0
  //   title: My Document
  //   author: Waylon
  //   created: 2026-06-28T12:00:00Z
  //   modified: 2026-06-28T12:30:00Z
  //   word_count: 42
  //   reading_time: 1
  //   theme: cognitience-light
  //   ---
  //   
  //   # My Document
  //   
  //   This is the **content** in *markdown*.

  buildCogJson(htmlContent: string, title: string, existingFilePath?: string): string {
    return this.buildCogMarkdown(htmlContent, title, existingFilePath);
  }

  /** Serialize editor HTML to the on-disk format implied by filePath extension. */
  serializeContent(htmlContent: string, title: string, filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.cog':
        return this.buildCogMarkdown(htmlContent, title, filePath);
      case '.md':
      case '.markdown':
        return this.htmlToMarkdown(htmlContent);
      case '.txt':
        return this.htmlToText(htmlContent);
      case '.html':
      case '.htm':
        return this.buildStandaloneHtml(htmlContent, title);
      default:
        throw new Error(
          `Unsupported save format "${ext}". Use Export for PDF, DOCX, and DOC.`,
        );
    }
  }

  buildStandaloneHtml(htmlContent: string, title: string): string {
    const safeTitle = (title || 'Untitled')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 20px; line-height: 1.6; font-size: 16px; color: #1e1e2e; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
h1, h2, h3, h4, h5, h6 { font-weight: 700; margin: 1em 0 0.3em; }
p { margin: 0 0 1em; }
blockquote { border-left: 3px solid #89b4fa; margin: 1em 0; padding: 0.5em 1em; background: #f5f5f5; }
pre { background: #f5f5f5; padding: 12px 16px; border-radius: 8px; overflow-x: auto; }
code { font-family: 'Consolas', monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 8px 12px; }
th { background: #f5f5f5; font-weight: 700; }
img { max-width: 100%; height: auto; border-radius: 8px; }
a { color: #6c5ce7; }
ul, ol { margin: 0 0 1em; padding-left: 2em; }
hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
</style>
</head>
<body>
${htmlContent}
</body>
</html>`;
  }

  buildCogMarkdown(htmlContent: string, title: string, existingFilePath?: string): string {
    const stats = this.computeStats(htmlContent);
    const now = new Date();
    const markdownBody = this.htmlToMarkdown(htmlContent);

    // Read existing frontmatter to preserve metadata across saves
    let existingMeta: Record<string, any> = {};
    let existingHistory: Array<{ ts: string; action: string }> = [];

    if (existingFilePath && fs.existsSync(existingFilePath)) {
      try {
        const raw = fs.readFileSync(existingFilePath, 'utf-8');
        const parsed = this.parseCogFile(raw);
        if (parsed) {
          existingMeta = parsed.frontmatter;
          existingHistory = parsed.frontmatter.history || [];
        }
      } catch {
        // Corrupted or old format — start fresh
      }
    }

    const isExisting = Object.keys(existingMeta).length > 0;

    const frontmatter: Record<string, any> = {
      magic: COGNITIENCE_DOC_FORMAT.magic,
      version: '3.0.0',
      title: title || 'Untitled',
      author: existingMeta.author || '',
      subject: existingMeta.subject || '',
      keywords: existingMeta.keywords || [],
      created: existingMeta.created || now.toISOString(),
      modified: now.toISOString(),
      app_version: APP_VERSION,
      format: 'cognitience-wp',
      word_count: stats.wordCount,
      char_count: stats.charCount,
      paragraph_count: stats.paragraphCount,
      reading_time: stats.readingTime,
      theme: existingMeta.theme || 'cognitience-light',
      font_family: existingMeta.font_family || "'Segoe UI', sans-serif",
      font_size: existingMeta.font_size || 16,
      line_height: existingMeta.line_height || 1.6,
      max_width: existingMeta.max_width || 720,
      history: [
        ...existingHistory,
        { ts: now.toISOString(), action: isExisting ? 'modified' : 'created' },
      ],
    };

    // Build: ---\n<yaml>\n---\n<markdown body>
    const yamlStr = yaml.dump(frontmatter, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });

    return `---\n${yamlStr}---\n\n${markdownBody}`;
  }

  /**
   * Parse a .cog file (v3 markdown+frontmatter or v2 JSON legacy).
   * Returns the frontmatter object and the content as HTML (for the editor).
   */
  parseCogFile(raw: string): { frontmatter: Record<string, any>; html: string; markdown: string; isLegacy: boolean } | null {
    // Check for v3 format: starts with ---
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('---')) {
      return this.parseCogV3(raw);
    }

    // Fallback: try v2 JSON format
    try {
      const json = JSON.parse(raw);
      if (json.magic !== COGNITIENCE_DOC_FORMAT.magic) return null;

      // v2 stored content as { type, html, plainText, markdown }
      let html = '';
      let markdown = '';
      if (json.content && typeof json.content === 'object') {
        html = json.content.html || '';
        markdown = json.content.markdown || '';
      } else if (typeof json.content === 'string') {
        // v1 fallback
        html = json.content;
        markdown = '';
      }

      // Convert v2 metadata keys to v3-style names for consistency
      const frontmatter = {
        magic: json.magic,
        version: '3.0.0', // upgrade on next save
        title: json.metadata?.title || 'Untitled',
        author: json.metadata?.author || '',
        subject: json.metadata?.subject || '',
        keywords: json.metadata?.keywords || [],
        created: json.metadata?.createdAt ? new Date(json.metadata.createdAt).toISOString() : new Date().toISOString(),
        modified: json.metadata?.modifiedAt ? new Date(json.metadata.modifiedAt).toISOString() : new Date().toISOString(),
        app_version: json.metadata?.appVersion || APP_VERSION,
        format: json.metadata?.format || 'cognitience-wp',
        word_count: json.metadata?.wordCount || 0,
        char_count: json.metadata?.charCount || 0,
        paragraph_count: json.metadata?.paragraphCount || 0,
        reading_time: json.metadata?.readingTime || 1,
        theme: json.styles?.theme || 'cognitience-light',
        font_family: json.styles?.fontFamily || "'Segoe UI', sans-serif",
        font_size: json.styles?.fontSize || 16,
        line_height: json.styles?.lineHeight || 1.6,
        max_width: json.styles?.maxWidth || 720,
        history: (json.history || []).map((h: any) => ({
          ts: h.timestamp ? new Date(h.timestamp).toISOString() : new Date().toISOString(),
          action: h.action || 'unknown',
        })),
      };

      return { frontmatter, html, markdown, isLegacy: true };
    } catch {
      return null;
    }
  }

  private parseCogV3(raw: string): { frontmatter: Record<string, any>; html: string; markdown: string; isLegacy: boolean } | null {
    // Extract frontmatter between --- delimiters
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;

    const [, yamlStr, body] = match;

    let frontmatter: Record<string, any>;
    try {
      frontmatter = yaml.load(yamlStr) || {};
    } catch {
      return null;
    }

    if (frontmatter.magic !== COGNITIENCE_DOC_FORMAT.magic) return null;

    const markdownBody = body.trim();

    // Convert markdown to HTML for the editor
    const html = this.markdownToHtml(markdownBody);

    return { frontmatter, html, markdown: markdownBody, isLegacy: false };
  }

  /**
   * Convert markdown to HTML (lightweight, no external deps).
   * Handles: headings, bold, italic, code, links, images, lists,
   * tables, blockquotes, horizontal rules, and paragraphs.
   */
  public markdownToHtml(md: string): string {
    let html = md;

    // Escape HTML entities first
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Headings
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    html = html.replace(/^---+$/gm, '<hr>');

    // Blockquote
    html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    // Un-escape > that was escaped (blockquotes use >)
    html = html.replace(/<blockquote>&gt;/g, '<blockquote>');

    // Tables (pipe syntax)
    html = html.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, _sep, body) => {
      const headers = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map((row: string) => {
        const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    });

    // Unordered lists
    html = html.replace(/(?:^[-*+]\s+.+\n?)+/gm, (match) => {
      const items = match.trim().split('\n').map((line: string) => {
        const text = line.replace(/^[-*+]\s+/, '');
        return `<li>${text}</li>`;
      }).join('');
      return `<ul>${items}</ul>`;
    });

    // Ordered lists
    html = html.replace(/(?:^\d+\.\s+.+\n?)+/gm, (match) => {
      const items = match.trim().split('\n').map((line: string) => {
        const text = line.replace(/^\d+\.\s+/, '');
        return `<li>${text}</li>`;
      }).join('');
      return `<ol>${items}</ol>`;
    });

    // Inline code (do before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (** or __)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic (* or _)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');

    // Strikethrough (~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

    // Paragraphs — wrap remaining lines that aren't already tags
    const lines = html.split('\n');
    let result = '';
    let inParagraph = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (inParagraph) {
          result += '</p>';
          inParagraph = false;
        }
      } else if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|table|img)/.test(trimmed)) {
        if (inParagraph) {
          result += '</p>';
          inParagraph = false;
        }
        result += trimmed + '\n';
      } else {
        if (!inParagraph) {
          result += '<p>';
          inParagraph = true;
        }
        result += trimmed + ' ';
      }
    }
    if (inParagraph) result += '</p>';

    return result.trim();
  }

  private exportCog(filePath: string, htmlContent: string, title: string) {
    fs.writeFileSync(filePath, this.buildCogMarkdown(htmlContent, title), 'utf-8');
  }

  // ─── Markdown ───────────────────────────────────────────

  private exportMarkdown(filePath: string, htmlContent: string) {
    const md = this.htmlToMarkdown(htmlContent);
    fs.writeFileSync(filePath, md, 'utf-8');
  }

  // ─── Plain Text ─────────────────────────────────────────

  private exportText(filePath: string, htmlContent: string) {
    const text = this.htmlToText(htmlContent);
    fs.writeFileSync(filePath, text, 'utf-8');
  }

  // ─── HTML ───────────────────────────────────────────────

  private exportHtml(filePath: string, htmlContent: string, title: string) {
    fs.writeFileSync(filePath, this.buildStandaloneHtml(htmlContent, title), 'utf-8');
  }

  // ─── PDF (via hidden BrowserWindow + printToPDF) ─────────

  private async exportPdf(filePath: string, htmlContent: string, title: string, parentWindow?: BrowserWindow): Promise<void> {
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 1100,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
      },
      parent: parentWindow,
    });

    const styledHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title || 'Untitled'}</title>
<style>
@page { margin: 1in; }
body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #000; }
h1 { font-size: 22pt; } h2 { font-size: 18pt; } h3 { font-size: 14pt; }
h4 { font-size: 12pt; } h5 { font-size: 11pt; } h6 { font-size: 10pt; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; margin: 1em 0 0.3em; }
p { margin: 0 0 1em; }
blockquote { border-left: 3px solid #999; margin: 1em 0; padding: 0.5em 1em; color: #555; }
pre { background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: 'Consolas', monospace; font-size: 10pt; }
code { font-family: 'Consolas', monospace; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #000; padding: 6px 10px; }
th { background: #eee; font-weight: bold; }
img { max-width: 100%; }
ul, ol { margin: 0 0 1em; padding-left: 2em; }
hr { border: none; border-top: 1px solid #999; margin: 1em 0; }
a { color: #000; text-decoration: underline; }
</style>
</head>
<body>${htmlContent}</body>
</html>`;

    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(styledHtml));

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 500));

    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });

    fs.writeFileSync(filePath, pdfBuffer);
    win.close();
  }

  // ─── DOCX (Office Open XML — minimal but valid) ──────────

  private async exportDocx(filePath: string, htmlContent: string, title: string): Promise<void> {
    const docxXml = this.buildDocx(htmlContent, title);
    const zip = await this.createDocxZip(docxXml);
    fs.writeFileSync(filePath, zip);
  }

  private buildDocx(htmlContent: string, title: string): Record<string, string> {
    // Convert HTML to OOXML paragraphs
    const paragraphs = this.htmlToDocxParagraphs(htmlContent);

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraphs}
<w:sectPr>
<w:pgSz w:w="12240" w:h="15840"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

    return {
      '[Content_Types].xml': contentTypesXml,
      '_rels/.rels': relsXml,
      'word/document.xml': documentXml,
      'word/_rels/document.xml.rels': wordRelsXml,
    };
  }

  private htmlToDocxParagraphs(html: string): string {
    let paragraphs = '';
    // Parse with a simple DOM
    let doc: Document | null;
    try {
      doc = new JSDOM(html).window.document;
    } catch {
      doc = null;
    }

    if (!doc) {
      // Simple text fallback
      const text = this.htmlToText(html);
      for (const line of text.split('\n')) {
        if (line.trim()) {
          paragraphs += `<w:p><w:r><w:t xml:space="preserve">${this.escapeXml(line)}</w:t></w:r></w:p>`;
        }
      }
      return paragraphs;
    }

    const body = doc.body;
    for (const node of body.childNodes) {
      paragraphs += this.nodeToDocx(node as Element);
    }
    return paragraphs;
  }

  private nodeToDocx(node: Element): string {
    if (node.nodeType === 3) { // Text node
      const text = node.textContent;
      if (text.trim()) {
        return `<w:p><w:r><w:t xml:space="preserve">${this.escapeXml(text)}</w:t></w:r></w:p>`;
      }
      return '';
    }
    if (node.nodeType !== 1) return '';

    const tag = (node as Element).tagName.toLowerCase();
    const text = node.textContent || '';
    const escapedText = this.escapeXml(text);

    switch (tag) {
      case 'h1': return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'h2': return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'h3': return `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'h4': return `<w:p><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'h5': return `<w:p><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'h6': return `<w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'p': return this.richTextToDocx(node as Element);
      case 'br': return `<w:p/>`;
      case 'hr': return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
      case 'blockquote': return `<w:p><w:pPr><w:ind w:left="720"/><w:pStyle w:val="Quote"/></w:pPr><w:r><w:i/><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'pre':
        return `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
      case 'ul':
        let ulItems = '';
        for (const li of (node as Element).querySelectorAll(':scope > li')) {
          ulItems += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${this.escapeXml(li.textContent || '')}</w:t></w:r></w:p>`;
        }
        return ulItems;
      case 'ol':
        let olItems = '';
        for (const li of (node as Element).querySelectorAll(':scope > li')) {
          olItems += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${this.escapeXml(li.textContent || '')}</w:t></w:r></w:p>`;
        }
        return olItems;
      case 'table':
        return this.tableToDocx(node as Element);
      default:
        if (text.trim()) {
          return `<w:p><w:r><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`;
        }
        return '';
    }
  }

  private richTextToDocx(element: Element): string {
    // Walk child nodes to handle bold/italic/underline/code inline
    let runs = '';
    for (const child of element.childNodes) {
      runs += this.inlineNodeToDocxRun(child as Element);
    }
    if (!runs) {
      const text = this.escapeXml(element.textContent || '');
      if (text.trim()) {
        runs = `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
      }
    }
    return `<w:p>${runs}</w:p>`;
  }

  private inlineNodeToDocxRun(node: Element): string {
    if (node.nodeType === 3) {
      const text = this.escapeXml(node.textContent || '');
      return text.trim() ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '';
    }
    if (node.nodeType !== 1) return '';

    const tag = (node as Element).tagName.toLowerCase();
    const text = this.escapeXml(node.textContent || '');
    if (!text.trim() && tag !== 'br') return '';

    let rPr = '';
    switch (tag) {
      case 'strong': case 'b': rPr = '<w:b/>'; break;
      case 'em': case 'i': rPr = '<w:i/>'; break;
      case 'u': rPr = '<w:u w:val="single"/>'; break;
      case 's': case 'strike': case 'del': rPr = '<w:strike/>'; break;
      case 'code': rPr = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'; break;
      case 'sub': rPr = '<w:vertAlign w:val="subscript"/>'; break;
      case 'sup': rPr = '<w:vertAlign w:val="superscript"/>'; break;
      case 'a':
        return `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
      case 'br': return '<w:r><w:br/></w:r>';
      case 'mark': rPr = '<w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/>'; break;
      default: break;
    }

    return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  }

  private tableToDocx(element: Element): string {
    let rows = '';
    const trs = element.querySelectorAll('tr');
    for (const tr of trs) {
      let cells = '';
      const tds = tr.querySelectorAll('th, td');
      for (const td of tds) {
        const isHeader = td.tagName.toLowerCase() === 'th';
        const text = this.escapeXml(td.textContent || '');
        const rPr = isHeader ? '<w:rPr><w:b/></w:rPr>' : '';
        cells += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
      }
      rows += `<w:tr>${cells}</w:tr>`;
    }
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
</w:tblBorders></w:tblPr>${rows}</w:tbl><w:p/>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private async createDocxZip(files: Record<string, string>): Promise<Buffer> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) {
      zip.file(name, content);
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  // ─── DOC (RTF format — universally compatible with Word) ─

  private exportDoc(filePath: string, htmlContent: string, title: string) {
    const rtf = this.htmlToRtf(htmlContent, title);
    fs.writeFileSync(filePath, rtf, 'utf-8');
  }

  private htmlToRtf(html: string, title: string): string {
    let rtf = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Segoe UI;}{\\f1 Consolas;}}';

    // Color table
    rtf += '{\\colortbl ;\\red0\\green0\\blue0;\\red89\\green180\\blue250;}';

    // Parse HTML and convert to RTF
    const text = this.htmlToText(html);
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.trim()) {
        // Escape RTF special characters
        const escaped = line
          .replace(/\\/g, '\\\\')
          .replace(/\{/g, '\\{')
          .replace(/\}/g, '\\}');
        rtf += `\\par ${escaped}`;
      }
    }

    rtf += '}';
    return rtf;
  }

  // ─── Utility: HTML to Markdown ──────────────────────────

  private htmlToMarkdown(element: HTMLElement | string): string {
    const html = typeof element === 'string' ? element : element.innerHTML;
    let md = html;

    // Headings
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
    md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');

    // Bold
    md = md.replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, '**$2**');
    // Italic
    md = md.replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, '*$2*');
    // Underline
    md = md.replace(/<u[^>]*>(.*?)<\/u>/gi, '__$1__');
    // Strikethrough
    md = md.replace(/<(s|strike|del)[^>]*>(.*?)<\/\1>/gi, '~~$2~~');
    // Inline code
    md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    // Links
    md = md.replace(/<a[^>]*href="(.*?)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    // Images
    md = md.replace(/<img[^>]*src="(.*?)"[^>]*alt="(.*?)"[^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]*src="(.*?)"[^>]*\/?>/gi, '![]($1)');

    // Code blocks
    md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

    // Blockquote
    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
      return '\n' + content.replace(/<p[^>]*>(.*?)<\/p>/gi, '> $1\n').trim() + '\n';
    });

    // Horizontal rule
    md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n');

    // Lists
    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
      return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
    });
    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
      let i = 1;
      return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${i++}. $1\n`);
    });

    // Checklists
    md = md.replace(/<li[^>]*class="[^"]*checked[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, '- [x] $1\n');
    md = md.replace(/<li[^>]*class="[^"]*checklist[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, '- [ ] $1\n');

    // Tables
    md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, content) => {
      let table = '\n';
      const rows = content.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      rows.forEach((row: string, i: number) => {
        const cells = (row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [])
          .map((c: string) => c.replace(/<[^>]+>/g, '').trim());
        table += '| ' + cells.join(' | ') + ' |\n';
        if (i === 0) {
          table += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        }
      });
      return table + '\n';
    });

    // Paragraphs and breaks
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');

    // Remove remaining tags
    md = md.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    md = md.replace(/&quot;/g, '"');
    md = md.replace(/&#39;/g, "'");
    md = md.replace(/&apos;/g, "'");

    // Clean up extra whitespace
    md = md.replace(/\n{3,}/g, '\n\n');
    md = md.trim() + '\n';

    return md;
  }

  // ─── Utility: HTML to Plain Text ────────────────────────

  private htmlToText(html: string): string {
    let text = html;
    // Convert <br> and <p> to newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<p[^>]*>/gi, '');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<div[^>]*>/gi, '');
    text = text.replace(/<li[^>]*>/gi, '  • ');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<hr\s*\/?>/gi, '\n---\n');
    // Remove all other tags
    text = text.replace(/<[^>]+>/g, '');
    // Decode entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");
    // Clean up
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  // ─── Utility: Compute Stats ─────────────────────────────

  private computeStats(html: string) {
    const text = this.htmlToText(html);
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const paragraphs = html.split(/<p[^>]*>/i).length - 1;
    return {
      wordCount: words.length,
      charCount: text.length,
      paragraphCount: Math.max(0, paragraphs),
      readingTime: Math.max(1, Math.ceil(words.length / 200)),
    };
  }
}

// ─── Types ──────────────────────────────────────────────────

export interface ExportRequest {
  format: 'cog' | 'markdown' | 'md' | 'txt' | 'plaintext' | 'html' | 'pdf' | 'docx' | 'doc';
  content: string;
  title: string;
  window?: BrowserWindow;
}

export interface CognitionDocFile {
  magic: string;
  version: string;
  metadata: {
    title: string;
    author: string;
    subject: string;
    keywords: string[];
    createdAt: number;
    modifiedAt: number;
    appVersion: string;
    format: string;
    wordCount: number;
    charCount: number;
    paragraphCount: number;
    readingTime: number;
  };
  content: {
    type: string;
    html: string;
    plainText: string;
    markdown: string;
  };
  styles: {
    theme: string;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    maxWidth: number;
  };
  history: Array<{
    timestamp: number;
    action: string;
    appVersion: string;
  }>;
}

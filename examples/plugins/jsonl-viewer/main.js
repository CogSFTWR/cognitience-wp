Cognitience.plugin.register(async (api) => {
  const panelBody = { el: null };

  api.files.registerOpener({
    extensions: ['jsonl'],
    open: async (file) => {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
      const rows = [];
      for (const line of lines) {
        try {
          rows.push(JSON.parse(line));
        } catch {
          rows.push({ _raw: line });
        }
      }
      const preview = rows
        .slice(0, 50)
        .map((r, i) => `${i + 1}. ${JSON.stringify(r)}`)
        .join('\n');
      const html =
        `<p><strong>${file.name}</strong> — ${rows.length} record(s)</p>` +
        `<pre class="jsonl-pre">${preview
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</pre>`;

      if (panelBody.el) {
        panelBody.el.innerHTML = html;
      } else {
        const panel = api.ui.addSidebarPanel({
          title: 'JSONL',
          html,
        });
        panelBody.el = panel && panel.querySelector('.plugin-panel-body');
      }

      // Also drop a short summary into the document
      api.doc.insertHtml(
        `<p data-jsonl-source="${file.name.replace(/"/g, '')}">Opened <code>${file.name}</code> (${rows.length} lines).</p>`
      );
      api.ui.notify(`JSONL: ${rows.length} records`);
    },
  });

  api.ui.addToolbarButton({
    title: 'JSONL tip',
    icon: 'data_object',
    onClick: () => {
      api.ui.notify('Open a .jsonl file via Open Document — this plugin handles it.');
    },
  });

  return () => {
    panelBody.el = null;
  };
});

Cognitience.plugin.register(async (api) => {
  api.commands.add('ai.draft', async () => {
    const sel = api.doc.getSelection();
    const seed = (sel && sel.text) || api.doc.getHtml().replace(/<[^>]+>/g, ' ').trim().slice(0, 500);
    const endpoint = api.store.get('endpoint', '');
    if (!endpoint) {
      const next = window.prompt(
        'AI endpoint URL (POST JSON { prompt }). Leave blank to insert a local stub draft.',
        api.store.get('endpoint', '')
      );
      if (next) api.store.set('endpoint', next.trim());
    }
    const url = api.store.get('endpoint', '');
    api.ui.setStatus('Drafting…', 'saving');
    try {
      let draft;
      if (url) {
        const res = await api.http.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: seed, mode: 'draft' }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json().catch(() => ({}));
        draft = data.text || data.draft || data.content || JSON.stringify(data);
      } else {
        draft =
          'Draft (local stub — set an endpoint via the toolbar button):\n\n' +
          (seed || 'Start with your outline here.');
      }
      const safe = String(draft)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/\n/g, '<br>');
      api.doc.insertHtml(`<blockquote data-ai-draft="1"><p>${safe}</p></blockquote>`);
      api.ui.notify('Draft inserted');
    } catch (e) {
      api.ui.notify(String(e.message || e), 'error');
    }
  });

  api.ui.addToolbarButton({
    title: 'AI draft',
    icon: 'edit_note',
    command: 'ai.draft',
  });

  api.ui.addToolbarButton({
    title: 'AI endpoint',
    icon: 'link',
    onClick: () => {
      const next = window.prompt('AI endpoint URL', api.store.get('endpoint', '') || '');
      if (next != null) api.store.set('endpoint', next.trim());
      api.ui.notify(next ? 'Endpoint saved' : 'Endpoint cleared');
    },
  });
});

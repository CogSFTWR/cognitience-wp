# Cognitience Website

Static site for the Cognitience suite — open-source, local-first office apps
(WP word processor, SS spreadsheet, PP presentations).

No build step. Open `index.html` or serve the folder:

```bash
npx serve .
# or
python -m http.server 8080
```

## Structure

```
index.html     Downloads (main page) — hero, app cards, openness/localness pillars
docs.html      Docs tab — renders markdown guides (extensions)
docs/          Markdown sources (extensions.md)
blog.html      Blog with release notes and essays
style.css      Monochrome liquid-glass design system (light + dark)
script.js      Theme toggle + pointer-driven glass specular
logo.png       Site/brand logo
logo-wp.png    Cognitience WP app icon (blue) — used on the WP download card
logo-ss.png    Cognitience SS app icon (green) — used on the SS download card
logo-pp.png    Cognitience PP app icon (red) — used on the PP download card
```

To publish a new release:
1. Build portable natives in each app repo (`npm run dist` on Windows).
2. Create a GitHub release with the `*_win.zip` (and CI Mac/Linux artifacts).
3. Update version pills and download `href`s on `index.html`.
4. Deploy this site (`npx vercel --prod` from this folder).

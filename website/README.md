# SilicaOS download site

Public page for the SilicaOS live ISO. Static files, no build.

Great Wave palette: white, red sun `#e60012`, black wave.

## Config

The download URL is a single constant in `config.js`:

```js
const SILICAOS_ISO = {
  url: "", // public R2 URL for silicaos-iso / silicaos-2026.11.13-x86_64.iso
  ...
};
```

Leave `url` empty until the ISO is public. The page then shows a placeholder instead of a live download.

## Preview

```bash
python3 -m http.server 8080
```

Vercel serves this folder (`vercel.json` in this directory). Root directory on the Cognitience team project is `website`.

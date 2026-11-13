# SilicaOS download site

Public page for the SilicaOS live ISO. Static files, no build.

Great Wave palette: white, red sun `#e60012`, black wave.

## Config

The download URL is a single constant in `config.js` (`SILICAOS_ISO.url`).

Current object:

`https://fzn8orkzkoaggkog.public.blob.vercel-storage.com/silicaos-2026.11.13-x86_64.iso`

SHA-256 `89db1c1709ec3e44f3d8178ce6728db1a55c0af34b31f6cf98f58e59e94d354f`, 2,259,714,048 bytes.

## Preview

```bash
python3 -m http.server 8080
```

Vercel serves this folder (`vercel.json` in this directory). Root directory on the Cognitience team project is `website`.

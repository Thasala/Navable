# Production Readiness

This branch prepares Navable for a demo deployment without publishing to the Chrome Web Store yet.

## Backend on Render

Use `render.yaml` from the repository root to create a Render Blueprint, or create a Web Service manually with these settings:

- Runtime: Docker
- Dockerfile path: `./backend/Dockerfile`
- Docker context: `./backend`
- Health check path: `/health`

Required environment variable:

```sh
OPENAI_API_KEY=...
```

Recommended demo environment variables:

```sh
NODE_ENV=production
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
CORS_ALLOW_ALL=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
NAVABLE_SETTINGS_WRITABLE=false
```

`CORS_ALLOW_ALL=true` is acceptable for a private demo while you are using an unpacked extension. Before publishing, set it to `false` and configure `NAVABLE_EXTENSION_ID` or `CORS_ORIGINS`.

## Extension Backend URL

After Render gives you a URL like:

```txt
https://navable-backend.onrender.com
```

replace `http://localhost:3000` in:

- `src/common/config.js`
- `src/background.js`

Then build:

```sh
npm run build
```

Load `dist/` as an unpacked extension in Chrome for demo testing.

## Chrome Store Later

When you are ready to publish:

1. Create or confirm the Chrome extension ID.
2. Set Render env vars:

```sh
CORS_ALLOW_ALL=false
NAVABLE_EXTENSION_ID=<chrome-extension-id>
```

3. Rebuild the extension with the Render backend URL.
4. Package `dist/` as a ZIP with `manifest.json` at the ZIP root.

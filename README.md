# Navable

## Backend (Docker)

Runs the local summarization API on `http://localhost:3000`.

```sh
export OPENAI_API_KEY="..."
docker compose up --build backend
curl http://localhost:3000/health
```

## Tests / CI (Docker)

Runs `npm run ci` (lint + Playwright tests) inside a Playwright container.

```sh
docker build -f Dockerfile.ci -t navable-ci .
docker run --rm navable-ci
```

Or via compose:

```sh
docker compose --profile ci run --rm ci
```

## Docker Publishing (GHCR)

The backend is automatically published to GitHub Container Registry (GHCR) on every push to `main`.

### Pull and run the published image:

```sh
docker pull ghcr.io/<OWNER>/<REPO>/navable-backend:latest
docker run -p 3000:3000 ghcr.io/<OWNER>/<REPO>/navable-backend:latest
```

### First-time setup (repo maintainer):

1. Go to repo **Settings** → **Actions** → **General**
2. Under "Workflow permissions", select **Read and write permissions**
3. Save changes

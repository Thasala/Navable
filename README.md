<p align="center">
  <img src="assets/navable-logo.svg" alt="Navable Logo" width="200"/>
</p>

# Navable

## Production prep

This repo now has a Render-ready backend blueprint in `render.yaml` and a production checklist in `docs/production.md`.

For a demo deployment, deploy the backend to Render first, set `OPENAI_API_KEY` there, then replace the extension backend URL in `src/common/config.js` and `src/background.js` with the Render HTTPS URL before running `npm run build`.

## Backend (Docker)

Runs the local AI backend on `http://localhost:3000` for page summarization, brief answers, and speech services.

```sh
export OPENAI_API_KEY="..."
docker compose up --build backend
curl http://localhost:3000/health
```

Swagger UI is available at `http://localhost:3000/api-docs` (OpenAPI JSON: `http://localhost:3000/api-docs.json`).

The packaged extension uses the production backend at `https://navable.onrender.com` by default. Local development can still override the backend base URL through `globalThis.__NAVABLE_CONFIG__.backendBaseUrl` before the extension scripts load.

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

## CI/CD (GitHub Actions)

Branch model:

- `develop` is the default development branch. Normal work and pull requests target `develop`.
- `production` is the release branch. Pushing or manually running CD from `production` publishes the backend image and deploys Render.
- `main` is no longer part of the active CI/CD flow.

Workflows used for the CI/CD demonstration:

- CI: `.github/workflows/main.yml` runs lint, Playwright tests, and an extension build on `develop`, `production`, and pull requests targeting either branch.
- Functional: `.github/workflows/docker-publish.yml` builds + publishes the backend Docker image (GHCR + Docker Hub), then triggers the Render production deployment.
- Non-functional: `.github/workflows/performance.yml` runs a quick AI-backed latency smoke test for `/api/assistant` (requires repo secret `OPENAI_API_KEY`).

The production workflows also support manual runs from the GitHub Actions tab, but their jobs only run from the `production` branch.

## Production CD (Docker + Render)

The backend image is published on every backend-related push to `production` (or manual workflow run from `production`). After both image pushes succeed, GitHub Actions triggers the Render production deploy hook and verifies:

```sh
https://navable.onrender.com/health
```

The workflow publishes both registries:

- Docker Hub: `thasala/navable-backend`
- GHCR: `ghcr.io/<OWNER>/<REPO>/navable-backend`

Render should be configured to deploy from either the Docker Hub image or the GHCR image. The workflow keeps both images current before triggering Render.

### Pull and run from Docker Hub:

```sh
docker pull thasala/navable-backend:latest
docker run --rm -p 3000:3000 thasala/navable-backend:latest
curl http://localhost:3000/health
```

### Pull and run from GHCR (optional):

```sh
docker pull ghcr.io/<OWNER>/<REPO>/navable-backend:latest
docker run --rm -p 3000:3000 ghcr.io/<OWNER>/<REPO>/navable-backend:latest
```

### First-time setup (repo maintainer):

1. Go to repo **Settings** → **Actions** → **General**
2. Under "Workflow permissions", select **Read and write permissions**
3. Save changes
4. Add repo secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `OPENAI_API_KEY`, `RENDER_DEPLOY_HOOK_URL`
5. In GitHub **Settings** → **Branches**, protect `production` and require pull requests plus the CI check before release merges.
6. In GitHub **Settings** → **Environments**, keep the `production` environment for deployment history and optional approval gates.
7. In Render, set production environment variables such as `OPENAI_API_KEY`.

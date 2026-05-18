<p align="center">
  <img src="assets/navable-logo.svg" alt="Navable Logo" width="200"/>
</p>

# Navable

## Backend (Docker)

Runs the local AI backend on `http://localhost:3000` for page summarization, brief answers, and speech services.

```sh
export OPENAI_API_KEY="..."
docker compose up --build backend
curl http://localhost:3000/health
```

Swagger UI is available at `http://localhost:3000/api-docs` (OpenAPI JSON: `http://localhost:3000/api-docs.json`).

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

Workflows used for the CI/CD demonstration:

- Functional: `.github/workflows/docker-publish.yml` builds + publishes the backend Docker image (GHCR + Docker Hub), then triggers the Render production deployment.
- Non-functional: `.github/workflows/performance.yml` runs a quick AI-backed latency smoke test for `/api/assistant` (requires repo secret `OPENAI_API_KEY`).

Both workflows also support manual runs from the GitHub Actions tab.

## Production CD (Docker + Render)

The backend image is published on every push to `main` (or manual workflow run). After both image pushes succeed, GitHub Actions triggers the Render production deploy hook and verifies:

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
5. In GitHub **Settings** → **Environments**, create a `production` environment if you want approval gates or deployment history.
6. In Render, set production environment variables such as `OPENAI_API_KEY`.

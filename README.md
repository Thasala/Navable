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

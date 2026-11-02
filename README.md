# Polarity

Polarity is a social network for positions, arguments, and changing your mind.

## Prerequisites

- Node.js `24.16.0` (see [`.nvmrc`](.nvmrc)); supported range is Node 24.
- npm, bundled with Node.

## Install and configure

```bash
npm ci
Copy-Item .env.example .env
npm run migrate
npm run dev
```

On macOS/Linux, replace the second command with `cp .env.example .env`. The template contains safe placeholder values only. `NEXT_PUBLIC_APP_URL` is required for production startup validation. `DATABASE_URL` is validated when supplied but is not used yet.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Run the production server after a build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run the Vitest suite. |
| `npm run migrate` | Apply versioned SQL migrations to local PGlite storage. |
| `npm run ci` | Run lint, typecheck, tests, and build in CI order. |

## Migrations

Run `npm run migrate` before local development when migrations have changed. It applies SQL files from `migrations/` to the local `.polarity-data/` PGlite database. Do not commit `.polarity-data/`.

## Deployment notes

The application has reproducible Node/npm setup and CI verification, but it is not ready for a public production launch. The active database is local, filesystem-backed PGlite; it is appropriate for local development, not a managed deployment. `DATABASE_URL` is documented and validated but intentionally unused until a managed PostgreSQL adapter is implemented. That adapter remains a launch blocker, along with production database operations and secrets management.

# Polarity

Polarity is a social network for positions, arguments, and changing your mind.

## Development

```bash
npm install
npm run dev
```

The local MVP uses embedded PostgreSQL-compatible PGlite storage in `.polarity-data/`, seeded on first run. It is intentionally server-side and durable across refreshes. Copy `.env.example` and configure `DATABASE_URL` before moving to a hosted PostgreSQL deployment.

Demo accounts are `maya`, `omar`, and `kevin`; each has password `welcome123`.

## Current MVP API

- `GET /api/feed` — persistent feed data
- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout` — secure cookie sessions
- `POST /api/posts` — authenticated post creation
- `POST /api/posts/:id/like` — authenticated persistent likes

# CareerPoint

A career platform for BIM professionals: profile, resume import/builder, deterministic BIM resume score, portfolio, real job ingestion and matching, application tracking, and an employer workspace.

## Run locally

```bash
docker compose up -d db                 # PostgreSQL on :5433
cp .env.example .env                    # set AUTH_SECRET
npm ci
npx prisma migrate deploy
SEED_DEMO=1 npm run db:seed             # admin + a verified demo employer (dev only)
npm run dev                             # web
npm run worker                          # background ingestion/matching/email (separate process)
```

Add job sources from **Admin → Job sources** or `npm run source:add -- greenhouse <board>`. No jobs are preconfigured or faked.

## Production

```bash
export AUTH_SECRET=$(openssl rand -hex 32)
export APP_URL=https://your-domain
docker compose up -d --build            # app (runs migrations on start) + worker + db
docker compose run --rm worker npx tsx prisma/seed.ts   # first admin: set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (not the example one)
```

- Terminate TLS in front of the app (reverse proxy/load balancer) and forward `X-Forwarded-For`.
- Health: `GET /api/health` (liveness), `GET /api/health/ready` (database, queue, worker heartbeat, storage, integrations; 503 only when the database or storage is down). Admin → System shows the detail.
- Logs: one JSON object per line (timestamp, level, event, request id, user/job/application/source ids, duration, error category).
- Back up the PostgreSQL volume and the file-storage volume (`/data/storage`).
- Scale workers with `docker compose up -d --scale worker=3` (queue claims are safe across processes).

## Quality gates

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
node e2e/verify.mjs                     # browser end-to-end against a running server (needs Chrome + the demo seed)
```

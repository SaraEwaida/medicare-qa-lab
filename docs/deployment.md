# Deployment: public demo link (Render + Neon, free tiers)

One Docker image serves both the API and the React app from the same origin. Hosting:

- **Render** (free web service) builds the `Dockerfile` from GitHub and redeploys on every push to `main`.
- **Neon** (free PostgreSQL) holds the database. Render's own free database expires after 30 days, which is a poor fit for a portfolio link.

On startup the container runs migrations (`alembic upgrade head`), seeds synthetic data (idempotent: it only creates base data when the database is empty), resets the Bug Lab sandbox, and starts the server. The real test reports in `backend/app/db/reports/` are loaded too, so the QA Lab shows dated, genuine results from the start.

## Steps

1. **Neon:** sign up at neon.tech with GitHub → **Create project** (region close to you) → copy the connection string from **Connect**. It looks like `postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
2. **Render:** sign up at render.com with GitHub → **New → Blueprint** → choose `SaraEwaida/medicare-qa-lab`. Render reads `render.yaml`.
3. When asked for `DATABASE_URL`, paste the Neon string. `JWT_SECRET` is generated automatically.
4. **Apply.** The first build takes about 5–8 minutes. The service URL looks like `https://medicare-qa-lab.onrender.com`.
5. Open `/api/v1/health`. It should return `{"status": "ok", "database": "ok", ...}`.

## Good to know

- **Cold starts:** free Render services sleep after 15 minutes without traffic and take about a minute to wake. Open the link a minute before a demo or interview.
- **Shared demo data:** anyone with the link can sign in with the demo accounts and change data. Data persists in Neon. To restore the original data, run the seed with `--reset` against the Neon URL from your machine:
  `DATABASE_URL='<neon url>' backend/.venv/bin/python -m app.db.seed --reset`
- **Disabling the Bug Lab** for a deployment: set `DEMO_BUGS_ENABLED=false` in Render. The Bug Lab page then says it's disabled, and no defect can fire.

## Local run without Docker

See the README's *Run locally* section. Docker Compose (`docker compose up --build`) starts PostgreSQL and the app together.

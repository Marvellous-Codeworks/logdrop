# logdrop

A generic, self-hostable, PrivateBin-style plain-text drop-off: anyone can upload text (or a `.txt` file) with no account; only an allow-listed set of maintainer emails can ever read an upload back, via a magic-link login. Uploads expire automatically after a configurable retention window.

## Stack

- TanStack Start + TanStack Router, React 19, Vite, Bun
- Vercel Blob for storage (no database)
- Resend for magic-link emails
- Cloudflare Turnstile for public-upload abuse mitigation
- Vercel Edge Config for a runtime upload kill-switch
- Vercel Cron for daily retention cleanup

## Local development

```bash
bun install
cp .env.example .env.local  # fill in the values described below
bun run dev
bun test
```

## Deploying

1. Create a new Vercel project from this repo.
2. Connect a **Vercel Blob** store to the project (provides `BLOB_READ_WRITE_TOKEN` automatically).
3. Connect a **Vercel Edge Config** store to the project (provides `EDGE_CONFIG` automatically); optionally add an `uploadsDisabled` boolean key to it as an emergency kill-switch.
4. Set the remaining environment variables from `.env.example` (`TOKEN_SECRET`, `ADMIN_EMAILS`, `RESEND_API_KEY`, `MAIL_FROM`, `SITE_URL`, `RETENTION_DAYS`, `MAX_UPLOAD_BYTES`, `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CRON_SECRET`).
5. Point a subdomain of your choice at the deployment (CNAME to Vercel) and set `SITE_URL` to match.
6. Deploy. The `/api/cron/cleanup` route runs daily via `vercel.json`.

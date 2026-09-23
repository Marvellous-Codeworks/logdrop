# logdrop

A generic, self-hostable, PrivateBin-style plain-text drop-off: anyone can upload text (or a `.txt` file) with no account; only an allow-listed set of maintainer emails can ever read an upload back, via a magic-link login. Uploads expire automatically after a configurable retention window.

## Stack

- TanStack Start + TanStack Router, React 19, Vite, Bun
- Vercel Blob for storage (no database)
- Resend for magic-link emails
- Cloudflare Turnstile for public-upload abuse mitigation
- Vercel Edge Config for a runtime upload kill-switch
- Vercel Cron for daily retention cleanup

## Credits

The favicon (`public/favicon.svg`) uses the "droplet" icon from [Lucide](https://lucide.dev) (ISC license).

## Local development

```bash
bun install
cp .env.example .env.local  # fill in the values described below
bun run dev
bun test
```

## Deploying

### 1. Create the Vercel project

Import this repo as a new Vercel project (or `vercel link` an existing one). Don't deploy yet — the app needs its storage and environment variables connected first, or the first build will crash on the first real upload.

### 2. Create and connect a Vercel Blob store

Vercel Dashboard → your project → **Storage** tab → **Create Database** → **Blob**.

- Give it a name, choose **Public** access (the app requests `access: "public"` explicitly and reads blobs with a plain `fetch()` — a "Private" store won't work without a different access model this codebase doesn't implement).
- After creating it, use **Connect Project** to attach it to this Vercel project (creating the store alone doesn't connect it — check the store's "Connected Projects" column afterwards; if it's empty, it isn't wired up yet).
- This provisions `BLOB_READ_WRITE_TOKEN` automatically once connected.

### 3. Create and connect a Vercel Edge Config store

Same **Storage** tab → **Create Database**. Vercel has renamed Edge Config to **Global Config** in the dashboard, but it's the same product — pick that one.

- Name it, create it, then **Connect Project** to this project the same way as the Blob store.
- This provisions `EDGE_CONFIG` automatically once connected.
- Optional: inside the store, add an `uploadsDisabled` boolean key (default `false`) — a runtime kill-switch for public uploads, flippable without a redeploy.

### 4. Create a Cloudflare Turnstile widget

Fastest via the Cloudflare dashboard directly (no CLI needed for a single widget):

1. [dash.cloudflare.com](https://dash.cloudflare.com/) → your account → **Turnstile** → **Add widget**.
2. Domain: add the subdomain you'll deploy to (see step 6) — you can add `localhost` too if you want to test locally.
3. Widget mode: **Managed**.
4. Create it, then copy the **Site Key** (→ `VITE_TURNSTILE_SITE_KEY`, safe to be public) and **Secret Key** (→ `TURNSTILE_SECRET_KEY`, keep private — only ever paste it into Vercel's env var, never elsewhere).

### 5. Generate the two app secrets

`TOKEN_SECRET` and `CRON_SECRET` are values you generate yourself — no external service issues them. Any long random string works, e.g.:

```bash
openssl rand -base64 32
```

Run it twice, once for each variable.

### 6. Set every environment variable

In the Vercel project → **Settings** → **Environment Variables**, set everything from `.env.example` that isn't auto-provisioned by steps 2–3:

| Variable | Where it comes from |
|---|---|
| `TOKEN_SECRET` | generated in step 5 |
| `ADMIN_EMAILS` | your own list, comma-separated |
| `RESEND_API_KEY`, `MAIL_FROM` | your [Resend](https://resend.com) account |
| `SITE_URL` | the subdomain you're deploying to, e.g. `https://logdrop.your-domain.example` (no trailing slash) |
| `RETENTION_DAYS`, `MAX_UPLOAD_BYTES` | defaults in `.env.example` are fine to start |
| `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | step 4 |
| `CRON_SECRET` | generated in step 5 |

`BLOB_READ_WRITE_TOKEN` and `EDGE_CONFIG` should already be present from steps 2–3 — double check they're listed before moving on.

### 7. Point your domain at the deployment

Add a CNAME for your chosen subdomain pointing at Vercel, and add that same domain to the Vercel project (**Settings** → **Domains**). Make sure it matches `SITE_URL` exactly.

### 8. Deploy

Trigger a deploy (or redeploy, if one already ran before steps 2–6 were finished — env vars and storage bindings only take effect on the build/runtime after they're set). The `/api/cron/cleanup` route then runs daily via `vercel.json`.

Test it by opening the site and uploading something. If the upload fails, check the Vercel function logs first — a generic "Upload failed" in the browser almost always means an env var or a storage connection was missed above.

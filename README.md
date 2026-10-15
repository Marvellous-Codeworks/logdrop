# logdrop

A generic, self-hostable, PrivateBin-style plain-text drop-off: anyone can upload text (or a `.txt` file) with no account; only an allow-listed set of maintainer emails can ever read an upload back, via a magic-link login. Uploads expire automatically after a configurable retention window.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMarvellous-Codeworks%2Flogdrop&project-name=logdrop&repository-name=logdrop&env=TOKEN_SECRET%2CADMIN_EMAILS%2CRESEND_API_KEY%2CMAIL_FROM%2CSITE_URL%2CVITE_TURNSTILE_SITE_KEY%2CTURNSTILE_SECRET_KEY%2CCRON_SECRET%2CRETENTION_DAYS%2CMAX_UPLOAD_BYTES&envDefaults=%7B%22RETENTION_DAYS%22%3A%227%22%2C%22MAX_UPLOAD_BYTES%22%3A%224194304%22%7D&envDescription=Admin%20allow-list%2C%20Resend%20mail%2C%20Cloudflare%20Turnstile%20keys%20and%20two%20secrets%20you%20generate%20yourself.%20See%20the%20README%20for%20each%20value.&envLink=https%3A%2F%2Fgithub.com%2FMarvellous-Codeworks%2Flogdrop%236-set-every-environment-variable&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D)

The button forks the repo, creates the Vercel project and its Blob store, and asks for the environment variables. A few things still need a manual step: see [Deploy with the button](#deploy-with-the-button).

## Stack

- TanStack Start + TanStack Router, React 19, Vite, Bun
- Vercel Blob for storage (no database)
- Resend for magic-link emails
- Cloudflare Turnstile for public-upload abuse mitigation
- Vercel Edge Config for a runtime upload kill-switch
- Vercel Cron for daily retention cleanup

## Admin features

- Mark an upload as **analyzed** once triaged — from its own page (single-click Mark/Unmark, no confirmation) or in bulk from the dashboard toolbar. A read-only checkmark badge next to the slug shows analyzed uploads at a glance in the dashboard table; a toolbar toggle hides/shows them. The upload's own page shows who marked it as analyzed and when.
- Delete an upload, single or in bulk, from the dashboard, or straight from the upload's own page — always through a custom on-screen confirmation modal (no native browser `confirm()`).
- A one-click back-to-admin button on every upload's page, and green flash + checkmark feedback on every copy/mark action.
- Branded magic-link login email (logo, `logdrop` wordmark and "Admin sign-in" title, as on the site), with a plain-text part for clients without HTML. The logo is `public/logo-email.png`, loaded from `SITE_URL`.
- Optional AI agent access: `GET /api/agent/paste/<slug>` lets your own AI agent tooling read a paste's content from a plain share link without an admin login, using a **personal agent token** (see [AI agent access](#ai-agent-access)). Every agent read is recorded, so the dashboard table shows a robot badge on uploads an agent has read, and the upload's own page shows how many times, when last and whose token was used.

## Admin sign-in

Admins sign in with a magic link sent to an address in `ADMIN_EMAILS`.

- **Single-use link.** The link works once, within 15 minutes of being requested. A second use, a use after 15 minutes, or a link superseded by a newer request is rejected with the same "expired or already used" message.
- **Confirm to sign in.** Opening the link shows a **Sign in** button; the link is only used when you press it. Mail security scanners that pre-open links (Safe Links and similar) therefore can't burn it before you click.
- **Browser-bound session.** The session cookie has no expiry date, so it ends when the browser session ends. Independently, the server ends every session 8 hours after sign-in, whatever the browser does with the cookie.
- **One session per admin.** Signing in on another browser or device ends your previous session there.
- **Sign out** (top right on every admin page) ends the session server-side, so a copied cookie stops working too.
- Neither the link token nor the session ID is stored in plain text: the Blob store keeps only SHA-256 hashes (`auth/` prefix), never your email address. The daily cleanup cron removes expired records.

**Upgrading from 1.3.x:** sessions issued by earlier versions are no longer accepted. After deploying, every admin signs in once more.

## AI agent access

Agent tokens are separate from the sign-in above: they don't expire with your session and keep working until you regenerate or revoke them.

Each admin manages their own token from the dashboard: under "Signed in as", open **AI agent access → Manage your token** to generate, regenerate or revoke it. No env var or redeploy is needed.

- The token (`ld_agent_…`) is shown **once**, right after it's generated. Copy it into your agent's config; if you lose it, regenerate it (the old one stops working immediately).
- It's stored only as a SHA-256 hash in the Blob store, next to the uploads.
- Reads are attributed to the token's owner, and the token stops working as soon as its owner is removed from `ADMIN_EMAILS`.
- The dashboard shows when your token was created and last used.

```bash
curl -H "Authorization: Bearer ld_agent_…" https://logdrop.your-domain.example/api/agent/paste/<slug>
```

The response is JSON with `slug`, `content` and `meta`; uploader IP, country, user agent, and which admins analyzed or read the upload are redacted.

**Migrating from `AGENT_API_TOKEN`:** the old instance-wide token still works but is deprecated (the dashboard flags it). Have each admin generate a personal token, move your agents to it, then delete `AGENT_API_TOKEN` from every Vercel environment and redeploy.

## License

[AGPL-3.0](https://github.com/Marvellous-Codeworks/logdrop/blob/main/LICENSE)

## Credits

The favicon (`public/favicon.svg`) and the email logo rendered from it (`public/logo-email.png`) use the "droplet" icon from [Lucide](https://lucide.dev) (ISC license).

## Local development

```bash
bun install
cp .env.example .env.local  # fill in the values described below
bun run dev
bun test
```

## Deploying

### Deploy with the button

The [Deploy with Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMarvellous-Codeworks%2Flogdrop&project-name=logdrop&repository-name=logdrop&env=TOKEN_SECRET%2CADMIN_EMAILS%2CRESEND_API_KEY%2CMAIL_FROM%2CSITE_URL%2CVITE_TURNSTILE_SITE_KEY%2CTURNSTILE_SECRET_KEY%2CCRON_SECRET%2CRETENTION_DAYS%2CMAX_UPLOAD_BYTES&envDefaults=%7B%22RETENTION_DAYS%22%3A%227%22%2C%22MAX_UPLOAD_BYTES%22%3A%224194304%22%7D&envDescription=Admin%20allow-list%2C%20Resend%20mail%2C%20Cloudflare%20Turnstile%20keys%20and%20two%20secrets%20you%20generate%20yourself.%20See%20the%20README%20for%20each%20value.&envLink=https%3A%2F%2Fgithub.com%2FMarvellous-Codeworks%2Flogdrop%236-set-every-environment-variable&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D) button runs the import for you: it forks this repo to your Git account, creates the Vercel project, creates and connects a **public** Blob store (`BLOB_READ_WRITE_TOKEN`), and asks for every environment variable in one form (`RETENTION_DAYS` and `MAX_UPLOAD_BYTES` come pre-filled).

Have these ready before you click, because the form asks for them:

- a Cloudflare Turnstile widget's keys ([step 4](#4-create-a-cloudflare-turnstile-widget));
- a Resend API key and sender address;
- `TOKEN_SECRET` and `CRON_SECRET` ([step 5](#5-generate-the-two-app-secrets));
- `SITE_URL`: the address you'll serve logdrop at. If you don't have a domain yet, use the `*.vercel.app` address Vercel shows for the project and change it later.

What the button can't do, so it's still manual:

- the optional Edge Config store for the upload kill-switch ([step 3](#3-create-and-connect-a-vercel-edge-config-store));
- adding your domain to the Turnstile widget and to the Vercel project ([step 7](#7-point-your-domain-at-the-deployment)).

After changing an environment variable or connecting a store, redeploy: the change only applies to new deployments.

The steps below are the full manual path, and the reference for every value the form asks for.

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
| `AGENT_API_TOKEN` | optional, **deprecated**: not needed, since each admin generates a personal token from the dashboard (see [AI agent access](#ai-agent-access)). Keep it only while existing agents still use it; if you do, enable it for every Vercel environment where those agents run, then redeploy |

Magic links are built from `SITE_URL`. To sign in on a Preview deployment, set `SITE_URL` in the **Preview** environment to that preview's address (for example the branch alias, `https://<project>-git-<branch>-<team>.vercel.app`); otherwise links requested there point at production.

`BLOB_READ_WRITE_TOKEN` and `EDGE_CONFIG` should already be present from steps 2–3 — double check they're listed before moving on.

### 7. Point your domain at the deployment

Add a CNAME for your chosen subdomain pointing at Vercel, and add that same domain to the Vercel project (**Settings** → **Domains**). Make sure it matches `SITE_URL` exactly.

### 8. Deploy

Trigger a deploy (or redeploy, if one already ran before steps 2–6 were finished — env vars and storage bindings only take effect on the build/runtime after they're set). The `/api/cron/cleanup` route then runs daily via `vercel.json`.

Test it by opening the site and uploading something. If the upload fails, check the Vercel function logs first — a generic "Upload failed" in the browser almost always means an env var or a storage connection was missed above.

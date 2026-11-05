<img src="public/favicon.svg" alt="logdrop" height="80" />

# logdrop

A generic, self-hostable, [PrivateBin](https://github.com/PrivateBin/PrivateBin)-style plain-text drop-off: anyone can upload text or a `.txt` file with no account, and only an allow-listed set of maintainers can ever read it back. Uploads expire automatically after a configurable retention window.

Project page at **[marvellouscode.works/logdrop](https://marvellouscode.works/logdrop)**, full documentation in the **[knowledge base](https://kb.marvellouscode.works/docs/logdrop/overview)**.

It was built so that [The Marvellous Suspender](https://github.com/gioxx/MarvellousSuspender) users could share a diagnostic report without pasting it into a public GitHub issue, but nothing in it is TMS-specific.

Marvellous Codeworks runs an instance at [logdrop.marvellouscode.works](https://logdrop.marvellouscode.works), kept available for TMS users. It isn't a shared public service for unrelated projects: for your own project, deploy your own.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMarvellous-Codeworks%2Flogdrop&project-name=logdrop&repository-name=logdrop&env=TOKEN_SECRET%2CADMIN_EMAILS%2CRESEND_API_KEY%2CMAIL_FROM%2CSITE_URL%2CVITE_TURNSTILE_SITE_KEY%2CTURNSTILE_SECRET_KEY%2CCRON_SECRET%2CRETENTION_DAYS%2CMAX_UPLOAD_BYTES&envDefaults=%7B%22RETENTION_DAYS%22%3A%227%22%2C%22MAX_UPLOAD_BYTES%22%3A%224194304%22%7D&envDescription=Admin%20allow-list%2C%20Resend%20mail%2C%20Cloudflare%20Turnstile%20keys%20and%20two%20secrets%20you%20generate%20yourself.%20See%20the%20documentation%20for%20each%20value.&envLink=https%3A%2F%2Fkb.marvellouscode.works%2Fdocs%2Flogdrop%2Fself-hosting%23environment-variables&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D)

## How it works

1. Someone uploads text from the home page, after a Cloudflare Turnstile check, and gets a link like `https://logdrop.example/r/<slug>`.
2. Opening that link requires an admin session: maintainers sign in with a magic link sent to an address in `ADMIN_EMAILS`. A leaked link is useless to anyone else.
3. Maintainers triage uploads from the admin dashboard: read, copy, download, mark as analyzed, delete.
4. A daily cleanup job deletes every upload older than the retention window, 7 days by default.

Optionally, a maintainer's AI agent can read uploads through the Agent API, with a personal token.

## Documentation

| Page | Content |
| --- | --- |
| [Overview](https://kb.marvellouscode.works/docs/logdrop/overview) | How it works, privacy model, limits and defaults |
| [Uploading a log](https://kb.marvellouscode.works/docs/logdrop/uploading) | The upload form and what happens next |
| [Admin sign-in](https://kb.marvellouscode.works/docs/logdrop/admin-login) | Magic links and sessions |
| [Admin dashboard](https://kb.marvellouscode.works/docs/logdrop/admin-dashboard) | Upload table, badges, bulk actions, AI agent access |
| [Log view](https://kb.marvellouscode.works/docs/logdrop/log-view) | A single upload's details, activity and actions |
| [Agent API](https://kb.marvellouscode.works/docs/logdrop/agent-api) | Tokens, request, response and redacted fields |
| [Self-hosting](https://kb.marvellouscode.works/docs/logdrop/self-hosting) | Deployment, environment variables, updating |
| [FAQ](https://kb.marvellouscode.works/docs/logdrop/faq) | Questions from uploaders and maintainers |

## Repository layout

| Path | Content |
| --- | --- |
| `src/routes/` | File-based routes: home page, `/r/<slug>`, `/admin` |
| `src/routes/api/` | Admin, agent and cron endpoints |
| `src/lib/` | Handlers, storage, authentication and their tests |
| `src/components/` | Shared UI |
| `public/` | Static files: favicon, email logo, social preview image |
| `vercel.json` | Daily cleanup schedule |
| `design.md` | The design system, read before changing a page |

## Stack

| Layer | Technology |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router), React 19 |
| Runtime and build | [Bun](https://bun.sh/), Vite |
| Storage | Vercel Blob, no database |
| Email | [Resend](https://resend.com), for magic links |
| Abuse mitigation | Cloudflare Turnstile, and a Vercel Edge Config key as a runtime upload kill-switch |
| Scheduled jobs | Vercel Cron |

## Local development

Requires [Bun](https://bun.sh/).

```bash
bun install                  # install dependencies
cp .env.example .env.local   # fill in the values
bun run dev                  # dev server with live reload
bun run build                # production build
bun test                     # tests
```

Add `localhost` to the Turnstile widget's domains to test uploads locally. Each variable is described in [`.env.example`](.env.example) and in the [environment variables reference](https://kb.marvellouscode.works/docs/logdrop/self-hosting#environment-variables).

## Deployment

logdrop runs on [Vercel](https://vercel.com/). The button above forks the repository, creates the project and its Blob store, and asks for the environment variables. A few steps stay manual, and the [self-hosting guide](https://kb.marvellouscode.works/docs/logdrop/self-hosting) covers them, along with the step-by-step path and how to update.

## Feedback

Found a mistake or have a suggestion? [Open an issue](https://github.com/Marvellous-Codeworks/logdrop/issues/new).

## License

- **Code**: [AGPL-3.0](LICENSE).
- **Names and logos** (Marvellous Codeworks, logdrop): not covered by the license, all rights reserved.
- **Icons**: the favicon (`public/favicon.svg`) and the email logo rendered from it (`public/logo-email.png`) use the "droplet" icon from [Lucide](https://lucide.dev) (ISC license).

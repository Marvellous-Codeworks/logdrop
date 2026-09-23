# Design — logdrop

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
modern-minimal

## Macrostructure family

logdrop has no marketing pages — every screen is a single-purpose utility
screen. Instead of a landing-page macrostructure, each page type gets its own
minimal shape, all sharing the same token system and component voice:

- **Upload frontpage (`/`)** — Centered Form. No hero, no narrative. One form,
  one action.
- **Admin login (`/admin/login`)** — Centered Card. A single email field.
- **Admin dashboard (`/admin`)** — Index-First. A table is the page.
- **Paste view (`/r/:slug`)** — Document / Code-Card. The pasted content
  renders inside a dark "code card" (Cobalt's signature move) since the
  content itself is usually a log or a piece of code.

## Theme
Cobalt (modern-minimal, dev-tool register)

- `--color-paper`      oklch(98.5% 0.004 250)
- `--color-paper-2`    oklch(96% 0.006 250)
- `--color-ink`        oklch(24% 0.02 258)
- `--color-ink-2`      oklch(34% 0.018 257)
- `--color-rule`       oklch(88% 0.01 255)
- `--color-rule-2`     oklch(80% 0.014 255)
- `--color-accent`     oklch(58% 0.20 256)
- `--color-accent-ink` oklch(99% 0.004 250)
- `--color-focus`      oklch(58% 0.20 256)
- `--color-graphite`   oklch(22% 0.016 260)  (the one dark band — code cards)
- `--color-error`      oklch(58% 0.20 25)
- `--color-muted`      oklch(52% 0.014 257)

## Typography
- Display: Space Grotesk, weight 500/600, style normal
- Body:    Inter, weight 400/500
- Mono:    JetBrains Mono, weight 400/500 (labels, status, and all pasted content)
- Display tracking: -0.02em
- Type scale anchor: `--text-display: clamp(2rem, 3vw + 1rem, 3.25rem)` (logdrop's
  displays are short utility headings, not marketing headlines — capped well
  under the usual landing-page ceiling)

## Spacing
4-point named scale (`--space-3xs` … `--space-3xl`), values in `tokens.css`
below. Pages use named tokens, never raw values.

## Motion
- Easings: `--ease-out: cubic-bezier(0.16,1,0.3,1)`, `--ease-in: cubic-bezier(0.7,0,0.84,0)`
- Reveal pattern: none — this is a utility app, not a marketing page. Pages
  are just there on load.
- Interaction motion only: button press, input focus, copy-to-clipboard label
  swap. Reduced-motion fallback: opacity-only, ≤150ms, or skip entirely.

## Microinteractions stance
- Silent success — the share-link URL appearing IS the confirmation, no toast.
- Copy-to-clipboard: label swaps to "Copied", no toast (see `copy.md` recipe).
- Errors get inline text, three-part: what broke, why (if known), what to do.

## CTA voice
- Primary CTA: solid cobalt fill, `--color-accent-ink` text, 6px radius, one
  per screen. Verb-first label ("Upload", "Send login link", "Delete").
- Secondary action (e.g. "Download as .txt"): outlined, same radius.

## Per-page allowances
- No page uses hero enrichment — function carries every page.
- The paste-view's code card is the one deliberate visual moment; nothing
  else on any page competes with it.

## What pages MUST share
- The wordmark "logdrop" (Space Grotesk 600, small, top-left).
- The cobalt accent, used only for the primary button, focus rings, active
  nav item, and the code card's status/label accents — never as a fill
  covering more than a few percent of any view.
- Space Grotesk + Inter + JetBrains Mono, hairline borders (never shadows
  beyond the one whisper-shadow on the code card), 6px/10px radii.
- The nav (wordmark + "Admin" link) and the single-line footer.

## What pages MAY differ on
- Layout shape only (form / card / table / document), per the macrostructure
  family above.

## Nav and footer
- **Nav:** N1 — wordmark "logdrop" + one link ("Admin" on the frontpage,
  nothing extra elsewhere). Two genuine destinations; a floating-pill or
  ⌘K nav would be theatre for an app this size.
- **Footer:** Ft2 — one line, hairline rule above: wordmark + a one-line
  description + a link to the source repo.

## New field: GitHub Issue link (optional)

An optional `issueUrl` field on the upload form, for the case where a
capture is tied to a bug report. Validated as a GitHub issue URL
(`https://github.com/<owner>/<repo>/issues/<number>`, owner/repo/number
each restricted to safe URL-path characters). Stored in `PasteMeta`,
rendered as a small mono-labelled chip linking out, on both the paste view
and the admin dashboard row. Never required, never validated against GitHub's
API (no external calls) — just checked against the shape of a real Issue URL.

## Exports

### tokens.css
See `public/app.css` `:root` block — this is a small app, the stylesheet
itself is the canonical token source; no separate export formats are
maintained (no Tailwind/DTCG/shadcn consumer exists in this codebase).

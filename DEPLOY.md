# The Build Session — Netlify Deployment & Operations Guide

Project: `motionplay-build-session` · Permanent URL: **https://workshop.motionplaylabs.com**
Status: built and locally verified. **Not deployed to Netlify, no DNS changed, no live payments
enabled — all awaiting your explicit approval.**

## 1. What is in this package

- `public/` — frontend: `index.html` (application form), `admin.html` (dashboard),
  `payment-success.html` (Stripe return page), `privacy.html`, `terms.html`, `refunds.html`.
- `netlify/functions/` — backend: `health`, `seats`, `enrol`, `stripe-webhook`,
  `admin-applicants`, `admin-action` (review / invite / remind / mark-paid /
  test-emails / capability / payments), `export`, plus `_shared.js`
  (Netlify Blobs store, Resend sender).
- `lib/` — shared logic used by BOTH the Express server and Netlify Functions:
  `classify.js` (assessment rules v1), `emails.js` (6 templates + Resend sender),
  `store.js` (file backend), `payments.js` (Stripe helpers).
- `server.js` — local-dev Express server with the same endpoints (for testing + Freebuff preview).
- `netlify.toml` — build config, `/api/*` redirects, security headers.
- `scripts/blobs-migrate.js` — Blobs backup / push / restore (migration + rollback).
- `workshop/` — legacy static copy for the old `/workshop` path (unchanged workflow).

## 2. Deploy to Netlify preview (no DNS, no live payments)

1. Push this folder to a GitHub repo (or drag-drop it in Netlify UI — GitHub recommended).
2. Netlify → Add new site → Import from Git → select the repo.
   Build settings are read from `netlify.toml` automatically
   (publish `public`, functions `netlify/functions`). Build command: none needed.
3. Before first deploy, set these environment variables
   (Site settings → Environment variables). Values are set by YOU in Netlify UI —
   they are never in this repo:
   - `SITE_URL` = the Netlify preview URL (update to `https://workshop.motionplaylabs.com` at go-live)
   - `ADMIN_TOKEN`, `ADMIN_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM`
   - `STRIPE_SECRET_KEY` = **test** key (`sk_test_…`), `STRIPE_WEBHOOK_SECRET` = test webhook secret
4. Deploy. Netlify gives you a preview URL like
   `https://<branch>--motionplay-build-session.netlify.app`.
5. In the Stripe Dashboard (test mode) → Developers → Webhooks → add endpoint:
   `https://<preview-url>/api/stripe-webhook`, event `checkout.session.completed`.
   Paste its signing secret into `STRIPE_WEBHOOK_SECRET`, redeploy.
6. Verify the connected account: open `/admin.html`, enter `ADMIN_TOKEN`, press
   **Check Stripe capability** (calls `/api/admin/payments-capability`). It reports
   key validity, account country and charges status.
7. Prove NGN acceptance (required before promising ₦85,000 payments): in test mode,
   accept one Guided Builder applicant, press **Invite**, pay with Stripe's NGN test
   card, confirm the webhook flips the seat to paid and both emails arrive. Then
   refund the test payment in the Stripe Dashboard and expire the test Checkout
   Session. If Stripe rejects the NGN session, STOP and report the exact error —
   do not convert to GBP; the app refuses non-GBP/NGN currencies by design.
8. Test on preview (see §6), then report back before any DNS or production step.

## 3. Required secrets (names only — set them in Netlify UI, never in chat or repo)

| Name | Purpose |
|---|---|
| `ADMIN_TOKEN` | Guards `/api/admin/*` + `/api/export` (long random string) |
| `ADMIN_EMAIL` | Receives admin notifications + test emails (`justin@motionplaylabs.com`) |
| `RESEND_API_KEY` | Resend authentication (domain `motionplaylabs.com` already verified) |
| `RESEND_FROM` | Sender (`MotionPlay Labs <hello@motionplaylabs.com>`) |
| `STRIPE_SECRET_KEY` | Stripe secret — **test key only** until you approve live |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (test endpoint until approval) |

Local migration script additionally needs `NETLIFY_SITE_ID` + `NETLIFY_AUTH_TOKEN`
(§5) — these never go in the app or the repo.

## 4. DNS for Names.co.uk (DO NOT APPLY without your approval)

Target: `workshop.motionplaylabs.com` → Netlify.

1. Netlify → Site settings → Domain management → Add custom domain →
   enter `workshop.motionplaylabs.com` (Netlify shows a verification note — stop there
   until you approve go-live).
2. In Names.co.uk → Domain → DNS records for `motionplaylabs.com`, add:
   - Type `CNAME`, Host `workshop`, Value `motionplay-build-session.netlify.app`, TTL 3600.
     (If Names.co.uk rejects CNAME alongside other records, use Netlify's shown A/ALIAS
     target instead — Netlify displays the exact value on the domain page.)
3. Wait for DNS + Netlify to provision HTTPS automatically (usually minutes to hours).
4. Set `SITE_URL=https://workshop.motionplaylabs.com` in Netlify env, redeploy,
   re-point the Stripe webhook to the custom domain, and re-test.

## 5. Database: migration and rollback

Production data lives in **Netlify Blobs** (store `build-session`, key `applicants.json`,
schema `{ applicants: [], processedEvents: [] }`). No SQL migration is required;
the schema is versioned (`rulesVersion: "v1"` on every record).

- **Backup production:** `NETLIFY_SITE_ID=… NETLIFY_AUTH_TOKEN=… node scripts/blobs-migrate.js backup`
  → writes `backups/blobs-<timestamp>.json` (commit-worthy, contains applicant PII — keep private).
- **Seed/migrate local data up:** `… node scripts/blobs-migrate.js push --from data/applicants.json`
  (always writes a pre-push backup first).
- **Rollback:** `… node scripts/blobs-migrate.js restore --file backups/<file>.json`
  (backs up current state first, then restores).
- Local dev uses `data/applicants.json` (same shape, git-ignored if present).

## 6. Stripe currency capability (verified 15 Oct 2026)

- Stripe lists **NGN as a supported card presentment currency**
  (docs.stripe.com/currencies); a UK account can generally create NGN Checkout
  Sessions for eligible Visa/Mastercard payments. `currency_not_supported` declines
  remain possible at card/issuer level.
- Standard Stripe card integration does **not** include Verve; Stripe's Naira-card
  local method is private preview, US business locations only — not available here.
- The app gates currencies explicitly (`SUPPORTED_FEES = GBP, NGN`) and surfaces
  Stripe errors verbatim — it never silently converts ₦85,000 to GBP.
- Account-level proof still requires your test keys: run the §2 step-7 NGN test on
  Netlify preview. If it fails, the documented alternative is Paystack for NGN
  (eligible Nigeria-based businesses, Visa/Mastercard/Verve) — NOT implemented;
  awaits your decision after the exact Stripe error is reported.

## 7. Test results (local, 15 Oct 2026)

PASS — classification: Guided Builder / Review Required / Foundation all returned with
scores + explanations; only Guided Builder is invite-eligible (Review invite → 403).
PASS — seats: applications do NOT consume seats; `/api/seats` counts verified paid only.
PASS — capacity: 8 × mark-paid → `paid:8, remaining:0`; 9th payment → 409, no oversell.
PASS — duplicates: repeat mark-paid → 409; webhook re-delivery → ignored via event id.
PASS — missing Stripe keys → clean 500 “Payments not configured”, server stays up.
PASS — export: 401 without token, 200 CSV with token.
PASS — pages: `/`, `/privacy.html`, `/terms.html`, `/refunds.html`, `/admin.html`,
`/payment-success.html` all 200.
PASS — all 6 email templates render with applicant assessment + registration details
(acceptance, review-required, future-cohort, payment-confirmation, admin-notification,
unpaid-reminder). Sent in console mode — see limitations.
PASS — repo secret scan: no `sk_*`, `re_*`, tokens, or token values in code.
BUG FOUND + FIXED — `/api/admin/test-emails` crashed on a sample result without
`breakdown`; template made defensive, sample fixed, endpoint re-tested 6/6 OK.

Second pass (this release):
PASS — invite expiry is exactly 24h; expired invites are detected; currency gate
refuses USD with “refusing to convert” (no network call made).
PASS — acceptance email contains first name, AI experience + project note, correct
fee, live remaining-seats count, 24h expiry, payment link, and states the seat is
confirmed only after payment; subject never claims a confirmed seat.
PASS — beginner → future-cohort email; borderline → Review Required, ineligible.
PASS — invite + capability endpoints fail cleanly without Stripe keys (no crash).
PASS — 8 payments fill the cohort; 9th blocked; duplicates 409; ledger holds 8
payment events; export CSV includes receipt/source/paidAt columns.
PASS — footer: all 3 project sites return 200, legal pages 200, all required
company/registration/contact/legal strings present, viewport + responsive classes intact.
NOT RUN (needs you): scenarios 4–8 end-to-end (Stripe test keys + Netlify preview),
real Resend delivery, Netlify deploy, DNS/HTTPS, production publish.

NOT RUN (needs you): real Resend delivery (needs `RESEND_API_KEY` in Secrets),
Stripe Checkout end-to-end + webhook signature (needs test keys + Netlify preview URL),
Netlify preview deploy itself, DNS/HTTPS, production publish.

## 8. Outstanding issues / decisions for you

1. **Stripe + NGN ₦85,000:** platform support confirmed in docs; per-account proof
   needs the §2 step-7 test on preview. **Mark paid is exception-only** (dashboard
   requires confirmation, ledger records `manual-exception`) — never the normal flow.
2. **Freebuff independence:** YES — the app runs independently of Freebuff.
   Netlify serves `public/` + functions; Blobs holds data; Resend/Stripe are direct
   integrations. Nothing calls Freebuff at runtime. (Legacy `worker.js` Cloudflare file
   is superseded and not part of the Netlify deploy.)
3. **Live payments + DNS + production** are all gated on your explicit approval — none done.

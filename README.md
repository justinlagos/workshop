# The Build Session — motionplaylabs.com/workshop

Functional enrolment site built from the Stitch high-converting variant.

- `workshop/index.html` — the site (works at `/` locally and at `/workshop` in production, no build step)
- `server.js` — Node + Express API: validation, 8-seat cap, duplicate check, rate limit, JSON storage, confirmation emails
- `workshop/enrol.php` — fallback for cPanel shared hosting without Node (uses PHP `mail()`)
- `data/enrolments.json` — created on first run, all applications

Form fields: fullName, email, country, whatsapp, aiExperience (Beginner/Basic/Intermediate), claudePlan (Yes/No/Not sure), projectGoal (10–300 chars) + honeypot + currency (£50 GBP / ₦85,000 NGN).

## Run locally

```bash
npm install
cp .env.example .env
node server.js
# open http://localhost:3000  (form POSTs to /api/enrol)
# subpath test: http://localhost:3000/workshop (form POSTs to /workshop/api/enrol)
```

Emails: if no `RESEND_API_KEY` or `SMTP_HOST` is set, emails log to console (dev mode) and the form still succeeds with `emailSent:false`.

## Configure emails (production)

Option A — Resend (recommended, free tier):
1. Sign up at resend.com, verify `motionplaylabs.com` (SPF/DKIM), create API key
2. Set `RESEND_API_KEY=` and `RESEND_FROM=MotionPlay Labs <hello@motionplaylabs.com>` (must be on verified domain)

Option B — SMTP (cPanel):
Set `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL`.

Applicant gets: confirmation + reference + fee + next steps. Admin (`ADMIN_EMAIL`) gets full application.

## Deploy to motionplaylabs.com/workshop

You have 3 options depending on your host:

**1. cPanel shared hosting (most likely — motionplaylabs.com resolves to 85.233.160.22):**
- Upload contents of `workshop/` to `public_html/workshop/` (so `index.html` is at `/workshop/index.html`)
- If your host runs Node: upload `server.js, package.json, data/` too, set up Node app with ProxyPass `/workshop/api` → node. Simpler: edit `workshop/index.html` fetch to use `enrol.php`, and ensure `data/` is writable.
- Test: `https://motionplaylabs.com/workshop/` → submit → check inbox + `data/enrolments.json`

**2. Vercel / Netlify / Cloudflare (static + serverless):**
- Serve `workshop/` as static at `/workshop`, deploy `server.js` as serverless function or adapt `/api/enrol` to function. CSV export at `/api/export?token=ADMIN_TOKEN`.

**3. VPS with reverse proxy:**
- Run `node server.js` (PORT 3000), proxy `location /workshop/ { proxy_pass http://127.0.0.1:3000/workshop/; }`

## Admin

- Seats: `GET /api/seats` → `{capacity:8, taken, remaining}`
- Export CSV: `GET /api/export?token=ADMIN_TOKEN`
- Data file: `data/enrolments.json` (back up regularly)

## Design source

Original Stitch files preserved in `stitch_workshop_enrolment_landing_page/` (2 variants + DESIGN.md). Live site uses the high-converting inline-form variant with real backend wired in.

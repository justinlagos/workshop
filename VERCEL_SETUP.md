# The Build Session: Vercel + Supabase integration

Status: **code deployed in testing configuration; live registrations and payments remain disabled until secret setup and full tests complete.**

## Infrastructure
- Vercel team: MotionPlay Labs; project: `workshop`; GitHub `justinlagos/workshop`.
- Supabase: Workshop (`imbhdffupsfehifcbdfb`), EU West.
- Custom domain intended: `https://workshop.motionplaylabs.com` (requires Names.co.uk CNAME activation and HTTPS check).
- Resend: `motionplaylabs.com` verified.
- Stripe: GBP £50, NGN ₦85,000. Account-level NGN capability unproven until test Checkout.

## Private Vercel environment variables
Already set: `SUPABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_EMAIL`, `SITE_URL`.

Still required, and NEVER committed to Git or shared in chat:
- `SUPABASE_SERVICE_ROLE_KEY`: Workshop Supabase project **legacy service_role key**; server-side sensitive only. Do NOT use the publishable/anon key. This implementation uses the service-role JWT in the PostgREST Authorization header.
- `ADMIN_TOKEN`: Long randomly generated private dashboard password; server-side sensitive.
- `STRIPE_SECRET_KEY`: Stripe **test-mode** secret beginning `sk_test_` to activate test Checkout. Live key intentionally rejected in acceptance/invitation code.
- `STRIPE_WEBHOOK_SECRET`: Test Stripe webhook endpoint signing secret `whsec_...`, for the endpoint `https://workshop.motionplaylabs.com/api/stripe-webhook`. Use the deployed accessible URL and verify HTTPS before making the endpoint in Stripe.

Set at Vercel > MotionPlay Labs > workshop > Settings > Environment Variables (Production / Preview as appropriate). Redeploy after changing values.

## Workflow
- `POST /api/enrol`: validates data, classifies using `lib/classify.js`, inserts a unique application, sends qualified applicants a test Checkout invitation only when safe credentials are configured, otherwise sends a received-and-qualified message. Foundation and Review Required do not receive payment links.
- `GET /api/seats`: verified-paid count from Supabase, not applications.
- `POST /api/stripe-webhook`: Stripe-signed payment event; checks paid status, amount, currency, applicant, Checkout session ID; invokes a locked transactional Supabase confirmation function.
- `/admin.html`: auth-protected review, invited payments, CSV export and email test via `api/admin.js`. Manual mark-paid disabled.
- `GET /api/health`: `registrationReady` only true with all required secrets (test-mode key).

## Safety and release tests
1. Test Foundation, Review Required and Guided Builder classifications and emails.
2. Verify Supabase persistence and duplicate-email rejection.
3. Test GBP 5000-pence Checkout and NGN 8500000-kobo Checkout from the actual merchant Stripe sandbox.
4. Verify the Stripe signature and replay idempotency; confirm attendance emails and admin notification.
5. Test seat allocation under concurrent payments and full cohort behaviour, including any excess successful payments/refund reconciliation.
6. Validate DNS, HTTPS, protected admin dashboard, all public legal pages and mobile design.
7. Confirm host plan permits commercial activity before enabling live GBP/NGN charges.

Never infer success from a Vercel green build alone. Do not activate live payments until all tests pass and the owner explicitly approves.

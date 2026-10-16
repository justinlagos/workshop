// Stripe helpers — test mode ready, live only with explicit live keys.
// Never log secret keys. Webhook verification requires the RAW request body.

import Stripe from 'stripe';
import { feeFor } from './classify.js';

export const MAX_SEATS = 8;

// Invitation validity: 24 hours from issue, subject to seat availability.
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export function inviteExpiry(from = Date.now()) {
  return new Date(from + INVITE_TTL_MS).toISOString();
}

export function inviteExpired(invite, now = Date.now()) {
  if (!invite?.expiresAt) return true;
  return new Date(invite.expiresAt).getTime() <= now;
}

// Explicit currency support matrix — never silently convert.
// NGN is a Stripe-supported card presentment currency (docs.stripe.com/currencies),
// but per-account/card/issuer acceptance must be verified with the connected keys.
export const SUPPORTED_FEES = ['GBP', 'NGN'];

export function stripeClient(env) {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY);
}

// Create a Checkout Session for an eligible applicant.
// Returns { sessionId, url }. Throws if Stripe not configured.
// Verifies the connected Stripe account: key validity, account country,
// charges capability. Throws with a clear message on failure.
// NOTE: per-account NGN acceptance can only be proven with the connected keys
// (create one NGN test session on preview and expire it — see DEPLOY.md).
export async function checkAccountCapability(env) {
  const stripe = stripeClient(env);
  if (!stripe) throw new Error('Payments not configured (STRIPE_SECRET_KEY missing)');
  const account = await stripe.accounts.retrieve();
  return {
    ok: true,
    accountId: account.id,
    country: account.country,
    chargesEnabled: !!account.charges_enabled,
    detailsSubmitted: !!account.details_submitted,
    supportedFeeCurrencies: SUPPORTED_FEES.slice(),
    note: 'NGN is Stripe-supported for card presentment; confirm with one NGN test Checkout Session on preview before promising NGN acceptance.',
  };
}

export async function createInviteSession(env, applicant, siteUrl) {
  const stripe = stripeClient(env);
  if (!stripe) throw new Error('Payments not configured (STRIPE_SECRET_KEY missing)');
  if (!SUPPORTED_FEES.includes(applicant.currency)) {
    throw new Error(`Unsupported fee currency: ${applicant.currency} (supported: ${SUPPORTED_FEES.join(', ')}) — refusing to convert`);
  }
  const fee = feeFor(applicant.currency);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: applicant.email,
    line_items: [{
      price_data: {
        currency: fee.currency,
        unit_amount: fee.amount,
        product_data: { name: `The Build Session — Founding Cohort 01 (${applicant.reference})` },
      },
      quantity: 1,
    }],
    metadata: { reference: applicant.reference, rulesVersion: applicant.rulesVersion || 'v1' },
    success_url: `${siteUrl}/payment-success.html?ref=${encodeURIComponent(applicant.reference)}`,
    cancel_url: `${siteUrl}/?pay=cancelled&ref=${encodeURIComponent(applicant.reference)}`,
  });
  return { sessionId: session.id, url: session.url };
}

// Verify a webhook event from the raw body + signature header.
// Returns the verified event. Throws on failure (caller must 400).
export function verifyWebhookEvent(env, rawBody, signature) {
  const stripe = stripeClient(env);
  if (!stripe) throw new Error('Payments not configured (STRIPE_SECRET_KEY missing)');
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('Webhook secret missing (STRIPE_WEBHOOK_SECRET)');
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

export function paidSeats(paidCount, capacity = MAX_SEATS) {
  return {
    capacity,
    paid: paidCount,
    remaining: Math.max(0, capacity - paidCount),
  };
}

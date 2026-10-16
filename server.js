// The Build Session — Express server (local dev + portable reference).
// Production equivalent: netlify/functions/* (same lib/ modules).
// Secrets ONLY from environment. Never log secrets. Never expose keys to frontend.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import validator from 'validator';
import { classify, feeFor, CLASSIFICATIONS, RULES_VERSION } from './lib/classify.js';
import {
  applicantAcceptance, reviewRequired, futureCohort,
  paymentConfirmation, adminNotification, unpaidReminder, sendMail,
} from './lib/emails.js';
import { createFileStore } from './lib/store.js';
import { createInviteSession, verifyWebhookEvent, paidSeats, inviteExpiry, inviteExpired, checkAccountCapability, MAX_SEATS } from './lib/payments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'justin@motionplaylabs.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const mailEnv = () => ({ RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_FROM: process.env.RESEND_FROM });

const store = createFileStore(path.join(__dirname, 'data', 'applicants.json'));

const seen = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (seen.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now); seen.set(ip, arr);
  return arr.length > 30;
}

// ---- Stripe webhook needs RAW body: mount BEFORE express.json ----
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = verifyWebhookEvent(process.env, req.body, sig);
  } catch (e) {
    console.log('[payments] webhook verification failed:', e.message);
    return res.status(400).json({ ok: false, error: 'Invalid signature' });
  }
  // Idempotency: duplicate delivery of the same event is a no-op.
  if (store.hasEvent(event.id)) {
    console.log(`[payments] duplicate event ${event.id} — ignored`);
    return res.json({ received: true, duplicate: true });
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const reference = session.metadata?.reference;
      const a = (session.id && store.getBySession(session.id)) || (reference && store.get(reference));
      if (!a) {
        console.log(`[payments] completed session for unknown applicant (ref=${reference})`);
      } else if (a.status === 'paid') {
        console.log(`[payments] duplicate payment for ${a.reference} — ignored`);
      } else {
        // Capacity guard: only the first MAX_SEATS verified payments get seats.
        const paid = store.paidCount();
        const result = { classification: a.classification, score: a.classificationScore, rulesVersion: a.rulesVersion };
        const wasExpired = inviteExpired(a.invite);
        if (paid >= MAX_SEATS) {
          store.update(a.reference, {
            status: 'waitlisted',
            payment: { receipt: session.id, amount: session.amount_total, currency: session.currency, paidAt: new Date().toISOString(), eventId: event.id },
          });
          store.logPayment({ reference: a.reference, receipt: session.id, amount: session.amount_total, currency: session.currency, source: 'stripe-webhook', eventId: event.id, outcome: 'waitlisted-refund-required' });
          console.log(`[payments] over-capacity paid event for ${a.reference} — waitlisted for refund`);
          const updated = store.get(a.reference);
          await sendMail(mailEnv(), { to: ADMIN_EMAIL, ...adminNotification(updated, updated.reference, result, 'payment', { note: 'OVER CAPACITY — waitlisted, refund required', seats: paidSeats(store.paidCount()) }) });
        } else {
          store.update(a.reference, {
            status: 'paid',
            payment: { receipt: session.id, amount: session.amount_total, currency: session.currency, paidAt: new Date().toISOString(), eventId: event.id },
          });
          store.logPayment({ reference: a.reference, receipt: session.id, amount: session.amount_total, currency: session.currency, source: 'stripe-webhook', eventId: event.id, outcome: 'paid' + (wasExpired ? '-after-invite-expiry' : '') });
          const updated = store.get(a.reference);
          try {
            await sendMail(mailEnv(), { to: updated.email, ...paymentConfirmation(updated, updated.reference, result, session.id, SITE_URL) });
          } catch (e) { console.log('[email] payment confirmation failed:', e.message); }
          try {
            await sendMail(mailEnv(), { to: ADMIN_EMAIL, ...adminNotification(updated, updated.reference, result, 'payment', { seats: paidSeats(store.paidCount()) }) });
          } catch (e) { console.log('[email] admin payment note failed:', e.message); }
        }
      }
    }
    store.markEvent(event.id);
    res.json({ received: true });
  } catch (e) {
    console.log('[payments] webhook handler error:', e.message);
    res.status(500).json({ ok: false, error: 'Handler error' });
  }
});

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/workshop', express.static(path.join(__dirname, 'public')));

function validate(body) {
  const errs = [];
  const d = {
    fullName: String(body.fullName || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    country: String(body.country || '').trim(),
    whatsapp: String(body.whatsapp || '').trim(),
    aiExperience: String(body.aiExperience || '').trim(),
    claudePlan: String(body.claudePlan || '').trim(),
    projectGoal: String(body.projectGoal || '').trim(),
    currency: String(body.currency || 'GBP').toUpperCase() === 'NGN' ? 'NGN' : 'GBP',
  };
  if (d.fullName.length < 2 || d.fullName.length > 80) errs.push('Full name is required');
  if (!validator.isEmail(d.email) || d.email.length > 120) errs.push('Valid email is required');
  if (!d.country) errs.push('Country is required');
  if (!['Beginner', 'Basic', 'Intermediate'].includes(d.aiExperience)) errs.push('AI experience is required');
  if (!['Yes', 'No', 'Not sure'].includes(d.claudePlan)) errs.push('Claude subscription answer is required');
  if (d.projectGoal.length < 10 || d.projectGoal.length > 300) errs.push('Project goal must be 10–300 characters');
  return { errs, d };
}

// Classification -> stored status. Only Guided Builder is payment-eligible.
function statusFor(result) {
  if (result.classification === CLASSIFICATIONS.GUIDED) return 'applied';
  if (result.classification === CLASSIFICATIONS.REVIEW) return 'reviewed';
  return 'foundation';
}

// ---- Public API ----
app.get('/api/health', (_req, res) => res.json({ ok: true, seats: paidSeats(store.paidCount()) }));

// Availability is based on VERIFIED PAID seats only — never on application count.
app.get('/api/seats', (_req, res) => res.json(paidSeats(store.paidCount())));

app.post('/api/enrol', async (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many requests, try again shortly.' });
  if (req.body.company_website) return res.status(400).json({ ok: false, error: 'Spam detected' });
  const { errs, d } = validate(req.body || {});
  if (errs.length) return res.status(400).json({ ok: false, error: errs[0], errors: errs });

  if (store.getByEmail(d.email)) {
    return res.status(409).json({ ok: false, error: 'This email already applied. Check your inbox or contact justin@motionplaylabs.com' });
  }
  const result = classify({ aiExperience: d.aiExperience, claudePlan: d.claudePlan, projectGoal: d.projectGoal });
  const ref = 'TBS-' + Date.now().toString(36).toUpperCase().slice(-6);
  const record = {
    ...d,
    reference: ref,
    classification: result.classification,
    classificationScore: result.score,
    classificationBreakdown: result.breakdown,
    rulesVersion: RULES_VERSION,
    status: statusFor(result),
    createdAt: new Date().toISOString(),
    ip: req.ip,
    invite: null,
    payment: null,
  };
  store.insert(record);

  // Transactional emails (server-side only). Never block enrolment on failure.
  let emailSent = false;
  try {
    let applicantMsg;
    if (result.classification === CLASSIFICATIONS.GUIDED) {
      // Acceptance email WITHOUT a payment link: the invite follows after admin review.
      // Reuse the review template shape with acceptance wording via applicantAcceptance
      // only once a session exists — here send a "received, eligible" note.
      applicantMsg = reviewRequired(record, ref, result, SITE_URL);
      applicantMsg.subject = `Your Build Session application ${ref} — accepted, payment invitation to follow`;
    } else if (result.classification === CLASSIFICATIONS.REVIEW) {
      applicantMsg = reviewRequired(record, ref, result, SITE_URL);
    } else {
      applicantMsg = futureCohort(record, ref, result, SITE_URL);
    }
    const r = await sendMail(mailEnv(), { to: d.email, ...applicantMsg });
    await sendMail(mailEnv(), { to: ADMIN_EMAIL, ...adminNotification(record, ref, result, 'application', { seats: paidSeats(store.paidCount()) }) });
    emailSent = r.via !== 'console';
  } catch (e) { console.log('[email] enrol failed:', e.message); }

  res.json({
    ok: true,
    reference: ref,
    emailSent,
    classification: result.classification,
    eligible: result.eligible,
    score: result.score,
    breakdown: result.breakdown,
    seats: paidSeats(store.paidCount()),
  });
});

// ---- Admin API (ADMIN_TOKEN required) ----
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token || req.body?.token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

app.get('/api/admin/applicants', requireAdmin, (_req, res) => {
  res.json({ ok: true, seats: paidSeats(store.paidCount()), applicants: store.all() });
});

// Manual review: accept (becomes Guided/applied) | review (stays reviewed) | future (foundation).
app.post('/api/admin/review', requireAdmin, async (req, res) => {
  const { reference, decision } = req.body || {};
  const a = store.get(String(reference || ''));
  if (!a) return res.status(404).json({ ok: false, error: 'Applicant not found' });
  if (!['accept', 'review', 'future'].includes(decision)) return res.status(400).json({ ok: false, error: 'Invalid decision' });
  let patch;
  if (decision === 'accept') {
    patch = { classification: CLASSIFICATIONS.GUIDED, status: 'applied', reviewedAt: new Date().toISOString(), reviewedDecision: decision };
  } else if (decision === 'review') {
    patch = { classification: CLASSIFICATIONS.REVIEW, status: 'reviewed', reviewedAt: new Date().toISOString(), reviewedDecision: decision };
  } else {
    patch = { classification: CLASSIFICATIONS.FOUNDATION, status: 'foundation', reviewedAt: new Date().toISOString(), reviewedDecision: decision };
  }
  const updated = store.update(a.reference, patch);
  // Notify applicant of the review outcome (server-side only).
  try {
    const result = { classification: updated.classification, score: updated.classificationScore, rulesVersion: updated.rulesVersion };
    if (decision === 'accept') {
      const msg = reviewRequired(updated, updated.reference, result, SITE_URL);
      msg.subject = `Your Build Session application ${updated.reference} — accepted, payment invitation to follow`;
      await sendMail(mailEnv(), { to: updated.email, ...msg });
    } else if (decision === 'future') {
      await sendMail(mailEnv(), { to: updated.email, ...futureCohort(updated, updated.reference, result, SITE_URL) });
    }
  } catch (e) { console.log('[email] review outcome failed:', e.message); }
  res.json({ ok: true, applicant: updated });
});

// Payment invitation — ONLY for Guided Builder (eligible) applicants.
app.post('/api/admin/invite', requireAdmin, async (req, res) => {
  const { reference } = req.body || {};
  const a = store.get(String(reference || ''));
  if (!a) return res.status(404).json({ ok: false, error: 'Applicant not found' });
  if (a.classification !== CLASSIFICATIONS.GUIDED || a.status === 'reviewed' || a.status === 'foundation') {
    return res.status(403).json({ ok: false, error: 'Only Guided Builder applicants can receive payment invitations' });
  }
  if (a.status === 'paid') return res.status(409).json({ ok: false, error: 'Already paid' });
  const s = paidSeats(store.paidCount());
  if (s.remaining <= 0) return res.status(409).json({ ok: false, error: 'Cohort is full (8 paid seats)' });
  // Reuse an existing unpaid invite instead of minting duplicates.
  // Reuse a live invite; an expired one needs a fresh session (re-invite).
  if (a.status === 'invited' && a.invite?.url && !inviteExpired(a.invite)) {
    return res.json({ ok: true, url: a.invite.url, reused: true, applicant: a });
  }
  try {
    const fee = feeFor(a.currency);
    const session = await createInviteSession(process.env, a, SITE_URL);
    const updated = store.update(a.reference, {
      status: 'invited',
      invite: { sessionId: session.sessionId, url: session.url, amount: fee.amount, currency: fee.currency, createdAt: new Date().toISOString(), expiresAt: inviteExpiry(), remindedAt: null },
    });
    const result = { classification: updated.classification, score: updated.classificationScore, rulesVersion: updated.rulesVersion };
    const inviteOpts = { seatsRemaining: paidSeats(store.paidCount()).remaining, expiresAt: updated.invite.expiresAt };
    try {
      await sendMail(mailEnv(), { to: updated.email, ...applicantAcceptance(updated, updated.reference, result, session.url, SITE_URL, inviteOpts) });
      await sendMail(mailEnv(), { to: ADMIN_EMAIL, ...adminNotification(updated, updated.reference, result, 'invite') });
    } catch (e) { console.log('[email] invitation failed:', e.message); }
    res.json({ ok: true, url: session.url, applicant: updated });
  } catch (e) {
    console.log('[payments] invite failed:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Unpaid invitation reminder (only invited + unpaid).
app.post('/api/admin/remind', requireAdmin, async (req, res) => {
  const { reference } = req.body || {};
  const a = store.get(String(reference || ''));
  if (!a) return res.status(404).json({ ok: false, error: 'Applicant not found' });
  if (a.status !== 'invited' || !a.invite?.url) return res.status(400).json({ ok: false, error: 'Only invited-unpaid applicants can be reminded' });
  try {
    const result = { classification: a.classification, score: a.classificationScore, rulesVersion: a.rulesVersion };
    await sendMail(mailEnv(), { to: a.email, ...unpaidReminder(a, a.reference, result, a.invite.url, SITE_URL, `This invitation expires ${a.invite.expiresAt || 'within 24 hours'}`) });
    const updated = store.update(a.reference, { invite: { ...a.invite, remindedAt: new Date().toISOString() } });
    await sendMail(mailEnv(), { to: ADMIN_EMAIL, ...adminNotification(updated, updated.reference, result, 'reminder') });
    res.json({ ok: true, applicant: updated });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Manual payment confirmation — e.g. NGN bank transfer verified by Justin.
// Capacity-guarded like the webhook; sends the same confirmation email.
app.post('/api/admin/mark-paid', requireAdmin, async (req, res) => {
  const { reference, receipt } = req.body || {};
  const a = store.get(String(reference || ''));
  if (!a) return res.status(404).json({ ok: false, error: 'Applicant not found' });
  if (a.status === 'paid') return res.status(409).json({ ok: false, error: 'Already paid' });
  if (a.classification !== CLASSIFICATIONS.GUIDED) {
    return res.status(403).json({ ok: false, error: 'Only Guided Builder applicants can be marked paid' });
  }
  const s = paidSeats(store.paidCount());
  if (s.remaining <= 0) return res.status(409).json({ ok: false, error: 'Cohort is full (8 paid seats)' });
  const fee = feeFor(a.currency);
  const updated = store.update(a.reference, {
    status: 'paid',
    payment: { receipt: String(receipt || 'manual').slice(0, 120), amount: fee.amount, currency: fee.currency, paidAt: new Date().toISOString(), eventId: null, manual: true },
  });
  store.logPayment({ reference: updated.reference, receipt: updated.payment.receipt, amount: fee.amount, currency: fee.currency, source: 'manual-exception', eventId: null, outcome: 'paid' });
  const result = { classification: updated.classification, score: updated.classificationScore, rulesVersion: updated.rulesVersion };
  try {
    await sendMail(mailEnv(), { to: updated.email, ...paymentConfirmation(updated, updated.reference, result, updated.payment.receipt, SITE_URL) });
  } catch (e) { console.log('[email] manual payment confirmation failed:', e.message); }
  res.json({ ok: true, applicant: updated });
});

// Stripe account capability report: key validity, country, charges status.
// Per-account NGN acceptance is proven with one NGN test session on preview.
app.get('/api/admin/payments-capability', requireAdmin, async (_req, res) => {
  try {
    res.json({ ok: true, capability: await checkAccountCapability(process.env) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Full booking + payment history ledger (append-only).
app.get('/api/admin/payments', requireAdmin, (_req, res) => {
  res.json({ ok: true, seats: paidSeats(store.paidCount()), payments: store.paymentHistory() });
});

app.get('/api/export', requireAdmin, (_req, res) => {
  const rows = store.all();
  const cols = ['reference', 'fullName', 'email', 'country', 'whatsapp', 'aiExperience', 'claudePlan', 'projectGoal', 'currency', 'classification', 'classificationScore', 'status', 'inviteExpiresAt', 'paymentReceipt', 'paymentSource', 'paidAt', 'createdAt'];
  const cell = (r, c) => {
    if (c === 'inviteExpiresAt') return r.invite?.expiresAt ?? '';
    if (c === 'paymentReceipt') return r.payment?.receipt ?? '';
    if (c === 'paymentSource') return !r.payment ? '' : (r.payment.manual ? 'manual-exception' : 'stripe-webhook');
    if (c === 'paidAt') return r.payment?.paidAt ?? '';
    return r[c] ?? '';
  };
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => JSON.stringify(cell(r, c))).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="build-session-applicants.csv"');
  res.send(csv);
});

// Test-only: render all six templates and send to ADMIN_EMAIL (requires ADMIN_TOKEN).
app.post('/api/admin/test-emails', requireAdmin, async (req, res) => {
  const to = ADMIN_EMAIL;
  const sample = {
    fullName: 'Test Applicant', email: to, country: 'United Kingdom', whatsapp: '+44 7000 000000',
    aiExperience: 'Basic', claudePlan: 'Yes', projectGoal: 'A portfolio site for my design work, shipped live within three weeks.',
    currency: 'GBP', reference: 'TBS-TEST01',
  };
  const result = { classification: CLASSIFICATIONS.GUIDED, score: 4, breakdown: ['Sample assessment'], rulesVersion: RULES_VERSION };
  const fee = feeFor('GBP');
  const payUrl = `${SITE_URL}/#pay-test-link`;
  const suite = [
    applicantAcceptance(sample, sample.reference, result, payUrl, SITE_URL, { seatsRemaining: paidSeats(store.paidCount()).remaining, expiresAt: inviteExpiry() }),
    reviewRequired(sample, sample.reference, { ...result, classification: CLASSIFICATIONS.REVIEW }, SITE_URL),
    futureCohort(sample, sample.reference, { ...result, classification: CLASSIFICATIONS.FOUNDATION }, SITE_URL),
    paymentConfirmation(sample, sample.reference, result, 'cs_test_receipt', SITE_URL),
    adminNotification(sample, sample.reference, result, 'application', { seats: paidSeats(store.paidCount()) }),
    unpaidReminder(sample, sample.reference, result, payUrl, SITE_URL),
  ];
  const results = [];
  for (const m of suite) {
    try {
      const r = await sendMail(mailEnv(), { to, ...m });
      results.push({ subject: m.subject, ok: true, via: r.via });
    } catch (e) { results.push({ subject: m.subject, ok: false, error: e.message }); }
  }
  res.json({ ok: true, results });
});

app.listen(PORT, () => console.log(`Build Session server on :${PORT}`));

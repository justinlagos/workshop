// POST /.netlify/functions/admin-action?action=review|invite|remind|mark-paid|test-emails
// Admin token via x-admin-token header (or JSON body field — header preferred).
import {
  store, classify as _classify, feeFor, CLASSIFICATIONS, RULES_VERSION,
  applicantAcceptance, reviewRequired, futureCohort,
  paymentConfirmation, adminNotification, unpaidReminder,
  createInviteSession, sendMail, siteUrl, adminEmail,
  paidSeats, MAX_SEATS, inviteExpiry, inviteExpired, checkAccountCapability,
  requireAdmin, parseBody, json,
} from './_shared.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!requireAdmin(event)) return json({ ok: false, error: 'unauthorized' }, 401);
  const action = event.queryStringParameters?.action;
  const body = parseBody(event);
  const url = siteUrl();

  if (action === 'capability') {
    try {
      return json({ ok: true, capability: await checkAccountCapability(process.env) });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  if (action === 'payments') {
    return json({ ok: true, seats: paidSeats(await store.paidCount()), payments: await store.paymentHistory() });
  }

  if (action === 'test-emails') {
    const to = adminEmail();
    const sample = {
      fullName: 'Test Applicant', email: to, country: 'United Kingdom', whatsapp: '+44 7000 000000',
      aiExperience: 'Basic', claudePlan: 'Yes', projectGoal: 'A portfolio site for my design work, shipped live within three weeks.',
      currency: 'GBP', reference: 'TBS-TEST01',
    };
    const result = { classification: CLASSIFICATIONS.GUIDED, score: 4, breakdown: ['Sample assessment'], rulesVersion: RULES_VERSION };
    const payUrl = `${url}/#pay-test-link`;
    const suite = [
      applicantAcceptance(sample, sample.reference, result, payUrl, url, { seatsRemaining: paidSeats(await store.paidCount()).remaining, expiresAt: inviteExpiry() }),
      reviewRequired(sample, sample.reference, { ...result, classification: CLASSIFICATIONS.REVIEW }, url),
      futureCohort(sample, sample.reference, { ...result, classification: CLASSIFICATIONS.FOUNDATION }, url),
      paymentConfirmation(sample, sample.reference, result, 'cs_test_receipt', url),
      adminNotification(sample, sample.reference, result, 'application', { seats: paidSeats(await store.paidCount()) }),
      unpaidReminder(sample, sample.reference, result, payUrl, url),
    ];
    const results = [];
    for (const m of suite) {
      try {
        const r = await sendMail({ to, ...m });
        results.push({ subject: m.subject, ok: true, via: r.via });
      } catch (e) { results.push({ subject: m.subject, ok: false, error: e.message }); }
    }
    return json({ ok: true, results });
  }

  const reference = String(body.reference || '');
  const a = await store.get(reference);
  if (!a) return json({ ok: false, error: 'Applicant not found' }, 404);

  if (action === 'review') {
    const { decision } = body;
    if (!['accept', 'review', 'future'].includes(decision)) return json({ ok: false, error: 'Invalid decision' }, 400);
    let patch;
    if (decision === 'accept') patch = { classification: CLASSIFICATIONS.GUIDED, status: 'applied', reviewedAt: new Date().toISOString(), reviewedDecision: decision };
    else if (decision === 'review') patch = { classification: CLASSIFICATIONS.REVIEW, status: 'reviewed', reviewedAt: new Date().toISOString(), reviewedDecision: decision };
    else patch = { classification: CLASSIFICATIONS.FOUNDATION, status: 'foundation', reviewedAt: new Date().toISOString(), reviewedDecision: decision };
    const updated = await store.update(a.reference, patch);
    try {
      const result = { classification: updated.classification, score: updated.classificationScore, rulesVersion: updated.rulesVersion };
      if (decision === 'accept') {
        const msg = reviewRequired(updated, updated.reference, result, url);
        msg.subject = `Your Build Session application ${updated.reference} — accepted, payment invitation to follow`;
        await sendMail({ to: updated.email, ...msg });
      } else if (decision === 'future') {
        await sendMail({ to: updated.email, ...futureCohort(updated, updated.reference, result, url) });
      }
    } catch (e) { console.log('[email] review outcome failed:', e.message); }
    return json({ ok: true, applicant: updated });
  }

  if (action === 'invite') {
    if (a.classification !== CLASSIFICATIONS.GUIDED || a.status === 'reviewed' || a.status === 'foundation') {
      return json({ ok: false, error: 'Only Guided Builder applicants can receive payment invitations' }, 403);
    }
    if (a.status === 'paid') return json({ ok: false, error: 'Already paid' }, 409);
    if (paidSeats(await store.paidCount()).remaining <= 0) {
      return json({ ok: false, error: 'Cohort is full (8 paid seats)' }, 409);
    }
    if (a.status === 'invited' && a.invite?.url && !inviteExpired(a.invite)) {
      return json({ ok: true, url: a.invite.url, reused: true, applicant: a });
    }
    try {
      const fee = feeFor(a.currency);
      const session = await createInviteSession(process.env, a, url);
      const updated = await store.update(a.reference, {
        status: 'invited',
        invite: { sessionId: session.sessionId, url: session.url, amount: fee.amount, currency: fee.currency, createdAt: new Date().toISOString(), expiresAt: inviteExpiry(), remindedAt: null },
      });
      const result = { classification: updated.classification, score: updated.classificationScore, rulesVersion: updated.rulesVersion };
      const inviteOpts = { seatsRemaining: paidSeats(await store.paidCount()).remaining, expiresAt: updated.invite.expiresAt };
      try {
        await sendMail({ to: updated.email, ...applicantAcceptance(updated, updated.reference, result, session.url, url, inviteOpts) });
        await sendMail({ to: adminEmail(), ...adminNotification(updated, updated.reference, result, 'invite') });
      } catch (e) { console.log('[email] invitation failed:', e.message); }
      return json({ ok: true, url: session.url, applicant: updated });
    } catch (e) {
      console.log('[payments] invite failed:', e.message);
      return json({ ok: false, error: e.message }, 500);
    }
  }

  if (action === 'remind') {
    if (a.status !== 'invited' || !a.invite?.url) return json({ ok: false, error: 'Only invited-unpaid applicants can be reminded' }, 400);
    try {
      const result = { classification: a.classification, score: a.classificationScore, rulesVersion: a.rulesVersion };
      await sendMail({ to: a.email, ...unpaidReminder(a, a.reference, result, a.invite.url, url, `This invitation expires ${a.invite.expiresAt || 'within 24 hours'}`) });
      const updated = await store.update(a.reference, { invite: { ...a.invite, remindedAt: new Date().toISOString() } });
      await sendMail({ to: adminEmail(), ...adminNotification(updated, updated.reference, result, 'reminder') });
      return json({ ok: true, applicant: updated });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  if (action === 'mark-paid') {
    if (a.status === 'paid') return json({ ok: false, error: 'Already paid' }, 409);
    if (a.classification !== CLASSIFICATIONS.GUIDED) {
      return json({ ok: false, error: 'Only Guided Builder applicants can be marked paid' }, 403);
    }
    if (paidSeats(await store.paidCount()).remaining <= 0) {
      return json({ ok: false, error: 'Cohort is full (8 paid seats)' }, 409);
    }
    const fee = feeFor(a.currency);
    const updated = await store.update(a.reference, {
      status: 'paid',
      payment: { receipt: String(body.receipt || 'manual').slice(0, 120), amount: fee.amount, currency: fee.currency, paidAt: new Date().toISOString(), eventId: null, manual: true },
    });
    await store.logPayment({ reference: updated.reference, receipt: updated.payment.receipt, amount: fee.amount, currency: fee.currency, source: 'manual-exception', eventId: null, outcome: 'paid' });
    const result = { classification: updated.classification, score: updated.classificationScore, rulesVersion: updated.rulesVersion };
    try {
      await sendMail({ to: updated.email, ...paymentConfirmation(updated, updated.reference, result, updated.payment.receipt, url) });
    } catch (e) { console.log('[email] manual payment confirmation failed:', e.message); }
    return json({ ok: true, applicant: updated });
  }

  return json({ ok: false, error: 'Unknown action' }, 400);
}

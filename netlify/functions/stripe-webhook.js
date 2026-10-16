import {
  store, verifyWebhookEvent, paymentConfirmation, adminNotification,
  sendMail, siteUrl, adminEmail, paidSeats, MAX_SEATS, json,
} from './_shared.js';

// Stripe requires the RAW body for signature verification.
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const sig = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
  const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
  let stripeEvent;
  try {
    stripeEvent = verifyWebhookEvent(process.env, raw, sig);
  } catch (e) {
    console.log('[payments] webhook verification failed:', e.message);
    return json({ ok: false, error: 'Invalid signature' }, 400);
  }
  if (await store.hasEvent(stripeEvent.id)) {
    console.log(`[payments] duplicate event ${stripeEvent.id} — ignored`);
    return json({ received: true, duplicate: true });
  }
  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const reference = session.metadata?.reference;
      const a = (session.id && await store.getBySession(session.id))
        || (reference && await store.get(reference));
      if (!a) {
        console.log(`[payments] completed session for unknown applicant (ref=${reference})`);
      } else if (a.status === 'paid') {
        console.log(`[payments] duplicate payment for ${a.reference} — ignored`);
      } else {
        const result = { classification: a.classification, score: a.classificationScore, rulesVersion: a.rulesVersion };
        const paid = await store.paidCount();
        if (paid >= MAX_SEATS) {
          await store.update(a.reference, {
            status: 'waitlisted',
            payment: { receipt: session.id, amount: session.amount_total, currency: session.currency, paidAt: new Date().toISOString(), eventId: stripeEvent.id },
          });
          await store.logPayment({ reference: a.reference, receipt: session.id, amount: session.amount_total, currency: session.currency, source: 'stripe-webhook', eventId: stripeEvent.id, outcome: 'waitlisted-refund-required' });
          console.log(`[payments] over-capacity paid event for ${a.reference} — waitlisted for refund`);
          const updated = await store.get(a.reference);
          await sendMail({ to: adminEmail(), ...adminNotification(updated, updated.reference, result, 'payment', { note: 'OVER CAPACITY — waitlisted, refund required', seats: paidSeats(await store.paidCount()) }) });
        } else {
          await store.update(a.reference, {
            status: 'paid',
            payment: { receipt: session.id, amount: session.amount_total, currency: session.currency, paidAt: new Date().toISOString(), eventId: stripeEvent.id },
          });
          await store.logPayment({ reference: a.reference, receipt: session.id, amount: session.amount_total, currency: session.currency, source: 'stripe-webhook', eventId: stripeEvent.id, outcome: 'paid' });
          const updated = await store.get(a.reference);
          try {
            await sendMail({ to: updated.email, ...paymentConfirmation(updated, updated.reference, result, session.id, siteUrl()) });
          } catch (e) { console.log('[email] payment confirmation failed:', e.message); }
          try {
            await sendMail({ to: adminEmail(), ...adminNotification(updated, updated.reference, result, 'payment', { seats: paidSeats(await store.paidCount()) }) });
          } catch (e) { console.log('[email] admin payment note failed:', e.message); }
        }
      }
    }
    await store.markEvent(stripeEvent.id);
    return json({ received: true });
  } catch (e) {
    console.log('[payments] webhook handler error:', e.message);
    return json({ ok: false, error: 'Handler error' }, 500);
  }
}

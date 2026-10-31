// What happens after workshop_confirm_payment has placed (or failed to place) an intake payer.
// Called from the Stripe webhook and from the payment-status check, whichever gets there first.
// Safe to call more than once: the database returns 'confirmed' only once per application,
// and the overflow refund uses a Stripe idempotency key.
import { db, mail, adminEmail, stripe } from '../api/_shared.js';
import { prepEmail } from './prep.js';
import { availability, getIntake, intakeFee } from './intake.js';
import { intakeConfirmed, intakeFullRefund, intakeAdmin } from './intake-emails.js';

export async function applicationByRef(ref) {
  return (await db('workshop_applications?reference=eq.' + encodeURIComponent(ref) + '&select=*'))[0] || null;
}
export async function cohortById(id) {
  if (!id) return null;
  return (await db('workshop_cohorts?id=eq.' + encodeURIComponent(id) + '&select=*'))[0] || null;
}

// Public shape for the success page.
export const sessionInfo = (c) => (c ? { id: c.id, label: c.label, sessionAt: c.session_at, durationMinutes: c.duration_minutes } : null);

export async function afterIntakePayment(outcome, reference, checkout) {
  const a = await applicationByRef(reference);
  if (!a) return { status: 'pending' };

  if (outcome === 'confirmed') {
    const cohort = await cohortById(a.cohort_id);
    const projected = a.projected_cohort_id && a.projected_cohort_id !== a.cohort_id ? await cohortById(a.projected_cohort_id) : null;
    const note = projected ? `${projected.label} filled before your payment went through, so you're in ${cohort.label}.` : '';
    try { await mail(a.email, cohort.join_url ? prepEmail(a, cohort, new Date(), { note }) : intakeConfirmed(a, cohort, { movedFrom: projected })); }
    catch (e) { console.error('Intake confirmation email failed', a.reference, e.message); }
    try {
      const av = await availability(a.intake_id);
      await mail(adminEmail(), intakeAdmin('Seat paid', a, { cohort, sessions: av.sessions, note: projected ? 'Shown ' + projected.label + ' when applying; that session filled first.' : '' }));
    } catch (e) { console.error('Intake admin email failed', a.reference, e.message); }
    return { status: 'confirmed', cohort };
  }

  // Paid after every seat had gone: refund in full. Retried on later calls until it succeeds.
  if (outcome === 'full-refund-required' || (outcome === 'refund-pending' && a.status === 'refund-required')) {
    const intake = await getIntake(a.intake_id);
    const fee = intakeFee(intake, a.currency);
    const feeLabel = a.fee_amount ? (a.currency === 'NGN' ? '₦' : '£') + (Number(a.fee_amount) / 100).toLocaleString('en-GB') : fee.label;
    const paymentIntent = typeof checkout?.payment_intent === 'string' ? checkout.payment_intent : checkout?.payment_intent?.id;
    let refunded = false;
    const client = stripe();
    if (client && paymentIntent) {
      try {
        await client.refunds.create({ payment_intent: paymentIntent, metadata: { reference: a.reference, reason: 'all-sessions-full' } }, { idempotencyKey: 'intake-full-' + checkout.id });
        await db('workshop_applications?reference=eq.' + encodeURIComponent(a.reference), { method: 'PATCH', body: { status: 'refunded' } });
        refunded = true;
      } catch (e) { console.error('Overflow refund failed', a.reference, e.message); }
    }
    if (refunded) {
      try { await mail(a.email, intakeFullRefund(a, feeLabel)); } catch (e) { console.error('Refund email failed', a.reference, e.message); }
    }
    try {
      await mail(adminEmail(), intakeAdmin(refunded ? 'Paid after every seat had gone, refunded automatically' : 'Needs you: paid after every seat had gone, refund in Stripe', a, { note: 'Stripe checkout: ' + (checkout?.id || '-') }));
    } catch (e) { console.error('Refund admin email failed', a.reference, e.message); }
    return { status: 'full', refunded };
  }

  if (outcome === 'already-paid' || outcome === 'duplicate-event') {
    return { status: a.status === 'paid' ? 'confirmed' : 'pending', cohort: await cohortById(a.cohort_id) };
  }
  if (outcome === 'refund-pending') return { status: 'full', refunded: a.status === 'refunded' };
  if (outcome === 'verification-mismatch') {
    console.error('INTAKE PAYMENT NEEDS RECONCILIATION', a.reference);
    try { await mail(adminEmail(), intakeAdmin('Needs you: payment did not match the booking', a, { note: 'Stripe checkout: ' + (checkout?.id || '-') })); } catch {}
    return { status: 'support' };
  }
  return { status: 'pending' };
}

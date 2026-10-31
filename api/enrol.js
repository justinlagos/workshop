// POST /api/enrol: the continuous booking form for the rolling intake (Cohorts 02 to 04).
// Anyone who confirms the prerequisites gets a Stripe Checkout link straight away. No session is
// fixed here: seats go in payment order, and the database places the payer when payment is verified.
// The response says which session a payment made now would land in, so the page can show it.
import { db, stripe, site, mail, adminEmail, configured, method, classify } from './_shared.js';
import { INTAKE_ID, getIntake, availability, intakeFee, sessionDay, sessionTimes } from '../lib/intake.js';
import { intakeApplication, intakeAdmin } from '../lib/intake-emails.js';

const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const LEVELS = ['Beginner', 'Basic', 'Intermediate'];
const CHECKOUT_TTL_S = 24 * 60 * 60 - 60;

function projectedOut(next) {
  return next ? { id: next.id, label: next.label, sessionAt: next.sessionAt, date: sessionDay(next.sessionAt), times: sessionTimes(next.sessionAt), remaining: next.remaining } : null;
}

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ ok: false, error: 'Booking is not set up yet.' });
  const b = req.body || {};
  if (b.company_website) return res.status(400).json({ ok: false, error: 'Invalid submission' });

  const fullName = String(b.fullName || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const country = String(b.country || '').trim().slice(0, 60);
  const whatsapp = String(b.whatsapp || '').trim().slice(0, 40);
  const experience = String(b.aiExperience || '');
  const goal = String(b.projectGoal || '').trim();
  if (fullName.length < 2 || fullName.length > 80) return res.status(400).json({ ok: false, error: 'Add your full name.' });
  if (!validEmail(email) || email.length > 120) return res.status(400).json({ ok: false, error: 'Add a valid email address.' });
  if (!country) return res.status(400).json({ ok: false, error: 'Add your country.' });
  if (!LEVELS.includes(experience)) return res.status(400).json({ ok: false, error: 'Choose your AI level.' });
  if (goal.length < 10 || goal.length > 300) return res.status(400).json({ ok: false, error: 'Describe what you want to build in 10 to 300 characters.' });
  if (b.prereqClaude !== true || b.prereqLaptop !== true) return res.status(400).json({ ok: false, error: 'Tick both requirements to continue.' });
  const currency = country.toLowerCase().includes('nigeria') ? 'NGN' : 'GBP';

  const client = stripe();
  if (!client) return res.status(503).json({ ok: false, error: 'Payments are not open yet. Try again later.' });

  let intake, av;
  try { intake = await getIntake(); av = await availability(); }
  catch (e) { console.error('intake lookup failed', e.message); return res.status(503).json({ ok: false, error: "We couldn't check seats just now. Try again in a minute." }); }
  if (!intake || !intake.is_open) return res.status(410).json({ ok: false, closed: true, error: 'Booking is closed. Join the list for the next dates.' });
  if (!av.next) return res.status(409).json({ ok: false, full: true, error: 'Every seat has gone. Join the list for the next dates.' });

  // One application per email per intake. Coming back re-issues a fresh payment link.
  let a = (await db('workshop_applications?intake_id=eq.' + encodeURIComponent(intake.id) + '&email=eq.' + encodeURIComponent(email) + '&select=*'))[0];
  if (a && a.status === 'paid') {
    const c = (await db('workshop_cohorts?id=eq.' + encodeURIComponent(a.cohort_id) + '&select=label,session_at'))[0];
    return res.status(409).json({ ok: false, booked: true, error: `You're already booked into ${c ? c.label + ' on ' + sessionDay(c.session_at) : 'a session'}. Check your email for the details.` });
  }
  if (a && ['refund-required', 'refunded'].includes(a.status)) {
    return res.status(409).json({ ok: false, error: 'Your earlier payment came in after every seat had gone and is being refunded. Email hello@motionplaylabs.com if anything looks wrong.' });
  }
  if (a && a.stripe_session_id) {
    try {
      const old = await client.checkout.sessions.retrieve(a.stripe_session_id);
      if (old.status === 'complete') return res.status(409).json({ ok: false, processing: true, reference: a.reference, error: 'Your payment is being confirmed. Check your email in a minute.' });
      if (old.status === 'open') await client.checkout.sessions.expire(old.id);
    } catch (e) { console.error('old checkout check failed', a.reference, e.message); }
  }

  if (!a) {
    const result = classify({ aiExperience: experience, claudePlan: 'Yes', projectGoal: goal });
    const row = {
      reference: 'TBS-' + crypto.randomUUID().slice(0, 10).toUpperCase(),
      intake_id: intake.id, cohort_id: null,
      full_name: fullName, email, country, whatsapp: whatsapp || null,
      ai_experience: experience, claude_plan: 'Yes', project_goal: goal, currency,
      classification: result.classification, score: result.score, breakdown: result.breakdown,
      status: 'applied',
    };
    try { a = (await db('workshop_applications', { method: 'POST', prefer: 'return=representation', body: row }))[0]; }
    catch (e) {
      if (e.code === '23505' || e.status === 409) return res.status(409).json({ ok: false, error: 'This email has just applied. Check your inbox for the payment link.' });
      console.error('application insert failed', e.message);
      return res.status(503).json({ ok: false, error: "We couldn't save that just now. Try again in a minute." });
    }
  }

  const fee = intakeFee(intake, a.currency);
  const amount = a.fee_amount ? Number(a.fee_amount) : fee.amount;
  const next = av.next;
  const nextWhen = `${next.label}, ${sessionDay(next.sessionAt)}, ${sessionTimes(next.sessionAt)}`;
  let checkout;
  try {
    checkout = await client.checkout.sessions.create({
      mode: 'payment',
      customer_email: a.email,
      client_reference_id: a.reference,
      line_items: [{ price_data: { currency: fee.currency, unit_amount: amount, product_data: { name: 'The Build Session · live online workshop', description: 'Three hours, live on Zoom. Seats go in payment order.' } }, quantity: 1 }],
      metadata: { reference: a.reference, intake: intake.id, projected_cohort: next.id },
      payment_intent_data: { metadata: { reference: a.reference, intake: intake.id } },
      custom_text: { submit: { message: `Seats go in payment order. Paying now puts you in ${nextWhen}. If that session fills while you pay, you'll be placed in the next one.` } },
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
      success_url: site() + '/payment-success.html?ref=' + encodeURIComponent(a.reference),
      cancel_url: site() + '/?payment=cancelled#book',
    });
  } catch (e) {
    console.error('checkout create failed', a.reference, e.message);
    return res.status(503).json({ ok: false, error: "Payment couldn't start just now. Try again in a minute." });
  }

  const expiresAt = new Date(checkout.expires_at * 1000).toISOString();
  const firstTime = a.status === 'applied';
  try {
    await db('workshop_applications?reference=eq.' + encodeURIComponent(a.reference), {
      method: 'PATCH',
      body: { status: 'invited', stripe_session_id: checkout.id, invite_url: checkout.url, invite_expires_at: expiresAt, projected_cohort_id: next.id },
    });
  } catch (e) {
    console.error('checkout save failed', a.reference, e.message);
    try { await client.checkout.sessions.expire(checkout.id); } catch {}
    return res.status(503).json({ ok: false, error: "We couldn't save that just now. Try again in a minute." });
  }

  const projectedCohort = { label: next.label, session_at: next.sessionAt, duration_minutes: 180 };
  try { await mail(a.email, intakeApplication(a, { payUrl: checkout.url, fee: { label: amount === fee.amount ? fee.label : (a.currency === 'NGN' ? '₦' : '£') + (amount / 100).toLocaleString('en-GB') }, projected: projectedCohort, expiresAt })); }
  catch (e) { console.error('application email failed', a.reference, e.message); }
  if (firstTime) {
    try { await mail(adminEmail(), intakeAdmin('New booking started', a, { sessions: av.sessions, note: 'Would land in: ' + next.label })); }
    catch (e) { console.error('admin email failed', a.reference, e.message); }
  }

  return res.status(201).json({ ok: true, reference: a.reference, checkoutUrl: checkout.url, fee: fee.label, projected: projectedOut(next) });
}

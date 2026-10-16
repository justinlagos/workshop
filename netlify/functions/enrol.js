import {
  store, classify, feeFor, CLASSIFICATIONS, RULES_VERSION,
  reviewRequired, futureCohort, adminNotification,
  sendMail, siteUrl, adminEmail, paidSeats, parseBody, json,
} from './_shared.js';

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const body = parseBody(event);
  if (body.company_website) return json({ ok: false, error: 'Spam detected' }, 400);

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
  const errs = [];
  if (d.fullName.length < 2 || d.fullName.length > 80) errs.push('Full name is required');
  if (!emailOk(d.email) || d.email.length > 120) errs.push('Valid email is required');
  if (!d.country) errs.push('Country is required');
  if (!['Beginner', 'Basic', 'Intermediate'].includes(d.aiExperience)) errs.push('AI experience is required');
  if (!['Yes', 'No', 'Not sure'].includes(d.claudePlan)) errs.push('Claude subscription answer is required');
  if (d.projectGoal.length < 10 || d.projectGoal.length > 300) errs.push('Project goal must be 10–300 characters');
  if (errs.length) return json({ ok: false, error: errs[0], errors: errs }, 400);

  if (await store.getByEmail(d.email)) {
    return json({ ok: false, error: 'This email already applied. Check your inbox or contact justin@motionplaylabs.com' }, 409);
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
    status: result.classification === CLASSIFICATIONS.GUIDED ? 'applied'
      : result.classification === CLASSIFICATIONS.REVIEW ? 'reviewed' : 'foundation',
    createdAt: new Date().toISOString(),
    ip: event.headers?.['client-ip'] || '',
    invite: null,
    payment: null,
  };
  await store.insert(record);

  let emailSent = false;
  try {
    const url = siteUrl();
    let msg;
    if (result.classification === CLASSIFICATIONS.GUIDED) {
      msg = reviewRequired(record, ref, result, url);
      msg.subject = `Your Build Session application ${ref} — accepted, payment invitation to follow`;
    } else if (result.classification === CLASSIFICATIONS.REVIEW) {
      msg = reviewRequired(record, ref, result, url);
    } else {
      msg = futureCohort(record, ref, result, url);
    }
    const r = await sendMail({ to: d.email, ...msg });
    await sendMail({ to: adminEmail(), ...adminNotification(record, ref, result, 'application', { seats: paidSeats(await store.paidCount()) }) });
    emailSent = r.via !== 'console';
  } catch (e) { console.log('[email] enrol failed:', e.message); }

  return json({
    ok: true, reference: ref, emailSent,
    classification: result.classification, eligible: result.eligible,
    score: result.score, breakdown: result.breakdown,
    seats: paidSeats(await store.paidCount()),
  });
}

// Transactional email — server-side only.
// Reads RESEND_API_KEY / RESEND_FROM / ADMIN_EMAIL from the environment at
// call time. Never import this module in frontend code. Never log keys.
//
// Six automated emails:
//   1. applicantAcceptance  — Guided Builder: accepted + payment invitation
//   2. reviewRequired       — manual review pending
//   3. futureCohort         — Foundation: priority for a future cohort
//   4. paymentConfirmation  — verified payment receipt + seat confirmed
//   5. adminNotification    — new application / payment / reminder events
//   6. unpaidReminder       — payment invitation expiring, pay link again

import { feeFor } from './classify.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shell(title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111">`
    + `<div style="background:#ccff00;padding:16px 20px;font-weight:900;font-size:15px">${esc(title)}</div>`
    + `<div style="padding:20px;border:1px solid #eee;font-size:14px;line-height:1.6">${bodyHtml}</div>`
    + `<div style="padding:12px 20px;font-size:11px;color:#888">MotionPlay Labs Ltd · justin@motionplaylabs.com · UK 17304660 / Nigeria RC 9621200</div></div>`;
}

function applicantLine(d) {
  return `<p style="color:#555">Your application: “${esc(d.projectGoal)}”`
    + ` (${esc(d.aiExperience)} · Claude: ${esc(d.claudePlan)} · ${esc(d.country)}).</p>`;
}

const WORKSHOP_LINE = 'Founding Cohort 01 · Sat 24 Oct 2026, 2–5pm · Online workshop';

// Assessment summary block shared by applicant emails.
function assessmentBlock(result) {
  return `<p><b>Assessment: ${esc(result.classification)}</b> (score ${result.score}). `
    + `${(result.breakdown || []).map(esc).join(' · ')}</p>`;
}

// 1. Acceptance + payment invitation (Guided Builder only).
// opts: { seatsRemaining, expiresAt } — both shown so nothing is over-promised.
// Never sent to Review Required / Foundation applicants (enforced by callers).
export function applicantAcceptance(d, ref, result, payUrl, siteUrl, opts = {}) {
  const fee = feeFor(d.currency);
  const first = esc(d.fullName.split(' ')[0] || d.fullName);
  const seatsLine = opts.seatsRemaining != null
    ? `<p><b>${opts.seatsRemaining} of 8 paid seats still available</b> — seats are confirmed in payment order.</p>`
    : '';
  const expiryLine = opts.expiresAt
    ? `<p>This invitation is valid for <b>24 hours (until ${esc(opts.expiresAt)})</b>, subject to seat availability. After that you may request a fresh invitation while seats remain.</p>`
    : '';
  const subject = `Accepted for The Build Session ${ref} — complete your seat (${fee.label})`;
  const html = shell(`THE BUILD SESSION — You're in, ${first} ✓`,
    `<p>Hi ${first},</p>`
    + `<p>Good news: your application for <b>${WORKSHOP_LINE}</b> was accepted — your AI experience (${esc(d.aiExperience)}) and your plan to build ${esc((d.projectGoal || '').slice(0, 120))} make you a strong fit for Cohort 01.</p>`
    + assessmentBlock(result)
    + `<p>Your reference is <b>${esc(ref)}</b>. Workshop fee: <b>${fee.label}</b>.</p>`
    + seatsLine
    + `<p><a href="${esc(payUrl)}" style="background:#ccff00;color:#000;font-weight:900;padding:12px 22px;text-decoration:none;display:inline-block">Complete payment — ${fee.label}</a></p>`
    + `<p><b>Your seat is confirmed only after successful payment.</b> This email alone does not reserve a seat.</p>`
    + expiryLine
    + applicantLine(d)
    + `<p>Questions? Reply to this email or write to justin@motionplaylabs.com.</p>`
    + `<p>— Justin Ukaegbu, MotionPlay Labs<br/><a href="${esc(siteUrl)}">${esc(siteUrl)}</a></p>`);
  const text = `Hi ${d.fullName}, accepted for The Build Session ${ref} (${result.classification}, score ${result.score}). Fee ${fee.label}.`
    + (opts.seatsRemaining != null ? ` ${opts.seatsRemaining}/8 seats left.` : '')
    + ` Pay here: ${payUrl} — seat confirmed only after payment.`
    + (opts.expiresAt ? ` Invitation valid 24h until ${opts.expiresAt}.` : '');
  return { subject, html, text };
}

// 2. Review required.
export function reviewRequired(d, ref, result, siteUrl) {
  const first = esc(d.fullName.split(' ')[0] || d.fullName);
  const subject = `Your Build Session application ${ref} — under review`;
  const html = shell('THE BUILD SESSION — Application under review',
    `<p>Hi ${first},</p>`
    + `<p>Thanks for applying for <b>${WORKSHOP_LINE}</b>. Your application needs a quick manual review before we can invite payment.</p>`
    + assessmentBlock(result)
    + `<p>Your reference is <b>${esc(ref)}</b>. Justin reviews every flagged application personally and will reply within 48 hours — either with a payment invitation or with a recommendation for a future cohort.</p>`
    + applicantLine(d)
    + `<p>— Justin Ukaegbu, MotionPlay Labs<br/><a href="${esc(siteUrl)}">${esc(siteUrl)}</a></p>`);
  const text = `Hi ${d.fullName}, your application ${ref} (${result.classification}) is under manual review. Justin replies within 48h.`;
  return { subject, html, text };
}

// 3. Future cohort (Foundation).
export function futureCohort(d, ref, result, siteUrl) {
  const first = esc(d.fullName.split(' ')[0] || d.fullName);
  const subject = `Your Build Session application ${ref} — priority for the next cohort`;
  const html = shell('THE BUILD SESSION — Next cohort priority',
    `<p>Hi ${first},</p>`
    + `<p>Thanks for applying for <b>${WORKSHOP_LINE}</b>. Founding Cohort 01 is a fast-paced build session, and based on your current experience we'd rather set you up to succeed in a future cohort with more foundations covered.</p>`
    + assessmentBlock(result)
    + `<p>Your reference is <b>${esc(ref)}</b>. You're on the priority list for the next cohort — no need to reapply, we'll email you first with onboarding steps.</p>`
    + applicantLine(d)
    + `<p>— Justin Ukaegbu, MotionPlay Labs<br/><a href="${esc(siteUrl)}">${esc(siteUrl)}</a></p>`);
  const text = `Hi ${d.fullName}, application ${ref} (${result.classification}): priority for the next cohort, no need to reapply.`;
  return { subject, html, text };
}

// 4. Payment confirmation (verified payment only).
export function paymentConfirmation(d, ref, result, receipt, siteUrl) {
  const fee = feeFor(d.currency);
  const first = esc(d.fullName.split(' ')[0] || d.fullName);
  const subject = `Seat confirmed ${ref} — The Build Session receipt`;
  const html = shell('THE BUILD SESSION — Seat confirmed ✓',
    `<p>Hi ${first},</p>`
    + `<p>Payment verified — your seat for <b>${WORKSHOP_LINE}</b> is confirmed.</p>`
    + `<p>Reference <b>${esc(ref)}</b> · Paid <b>${fee.label}</b> · Receipt <b>${esc(receipt)}</b></p>`
    + `<p>What happens next: onboarding details and the workshop link arrive by email at least 48 hours before the session, plus 21 days of follow-up support afterwards.</p>`
    + `<p>Cancellation: you may cancel up to 24 hours before the session for a refund, subject to applicable consumer law. See the Cancellation &amp; Refund Policy on the site.</p>`
    + `<p>— Justin Ukaegbu, MotionPlay Labs<br/><a href="${esc(siteUrl)}">${esc(siteUrl)}</a></p>`);
  const text = `Hi ${d.fullName}, payment verified for ${ref} (${fee.label}). Seat confirmed for Sat 24 Oct 2026. Onboarding follows by email.`;
  return { subject, html, text };
}

// 5. Admin notification — event variants: application | payment | reminder | invite.
export function adminNotification(d, ref, result, event, extra = {}) {
  const fee = feeFor(d.currency);
  const titles = {
    application: `New application ${ref} — ${d.fullName} [${result.classification}]`,
    payment: `Payment confirmed ${ref} — ${d.fullName} (${fee.label})`,
    invite: `Payment invite sent ${ref} — ${d.fullName}`,
    reminder: `Reminder sent ${ref} — ${d.fullName} (unpaid)`,
  };
  const subject = titles[event] || `Workshop event ${ref}`;
  const html = `<div style="font-family:Arial,sans-serif"><h2>${esc(subject)}</h2>`
    + `<ul><li><b>Name:</b> ${esc(d.fullName)}</li><li><b>Email:</b> ${esc(d.email)}</li>`
    + `<li><b>Country:</b> ${esc(d.country)}</li><li><b>WhatsApp:</b> ${esc(d.whatsapp || '-')}</li>`
    + `<li><b>AI level:</b> ${esc(d.aiExperience)}</li><li><b>Claude:</b> ${esc(d.claudePlan)}</li>`
    + `<li><b>Fee:</b> ${fee.label}</li><li><b>Assessment:</b> ${esc(result.classification)} (score ${result.score}, ${esc(result.rulesVersion)})</li></ul>`
    + `<p><b>Goal:</b> ${esc(d.projectGoal)}</p>`
    + (extra.note ? `<p><b>Note:</b> ${esc(extra.note)}</p>` : '')
    + (extra.seats != null ? `<p>Paid seats taken: ${extra.seats.paid}/${extra.seats.capacity} · remaining ${extra.seats.remaining}</p>` : '')
    + `</div>`;
  const text = `${subject} — ${d.fullName} <${d.email}> ${result.classification}.`;
  return { subject, html, text };
}

// 6. Unpaid invitation reminder.
export function unpaidReminder(d, ref, result, payUrl, siteUrl, expiresNote) {
  const fee = feeFor(d.currency);
  const first = esc(d.fullName.split(' ')[0] || d.fullName);
  const subject = `Reminder: your Build Session seat ${ref} is waiting (${fee.label})`;
  const html = shell('THE BUILD SESSION — Your seat is waiting',
    `<p>Hi ${first},</p>`
    + `<p>A quick reminder: your payment invitation for <b>${WORKSHOP_LINE}</b> is still unpaid.</p>`
    + `<p>Reference <b>${esc(ref)}</b> · Fee <b>${fee.label}</b>${expiresNote ? ` · ${esc(expiresNote)}` : ''}</p>`
    + `<p><a href="${esc(payUrl)}" style="background:#ccff00;color:#000;font-weight:900;padding:12px 22px;text-decoration:none;display:inline-block">Pay now — ${fee.label}</a></p>`
    + `<p>Seats are confirmed in payment order and only 8 exist. If you've changed your mind, just ignore this email and we'll release your hold.</p>`
    + `<p>— Justin Ukaegbu, MotionPlay Labs<br/><a href="${esc(siteUrl)}">${esc(siteUrl)}</a></p>`);
  const text = `Reminder: seat ${ref} (${fee.label}) unpaid. Pay: ${payUrl}`;
  return { subject, html, text };
}

// Resend sender. Returns {via:'resend'|'console'}. Throws on Resend API error.
// env must provide RESEND_API_KEY; RESEND_FROM optional.
export async function sendMail(env, { to, subject, html, text }) {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:console] to=${to} subject=${subject}`);
    return { via: 'console' };
  }
  const from = env.RESEND_FROM || 'MotionPlay Labs <hello@motionplaylabs.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error('Resend error ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return { via: 'resend' };
}

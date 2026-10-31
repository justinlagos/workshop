// Kit features beyond sign-in: questions, feedback forms, kit updates, members and scheduled mail.
import crypto from 'node:crypto';
import { db } from '../api/_shared.js';

// The Ask box is open from the start of a cohort's session to the end of its support window.
// The host (no cohort) can always ask.
export const askOpen = (cohort, now = new Date()) =>
  !cohort || (now >= new Date(cohort.session_at) && now < new Date(cohort.support_ends_at || 0));
export const HOST_REF = 'TBS-HOST-0001';
// The designers in Cohort 01, asked on Saturday to test Void Canvas.
export const DESIGNERS = ['TBS-44667638-D', 'TBS-A3DC8C5C-1'];
export const FORMS = ['workshop', 'voidcanvas'];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const enc = encodeURIComponent;

// ---------- Members ----------
export async function attendees(cohortId = 'cohort-01') {
  return db(`workshop_applications?cohort_id=eq.${enc(cohortId)}&status=eq.paid&select=reference,full_name,email,country,currency,project_goal&order=created_at`);
}
export async function hostMember() {
  const rows = await db(`workshop_kit_members?reference=eq.${HOST_REF}&select=reference,full_name,email,role`);
  return rows[0] || null;
}
export async function applicationFor(reference) {
  const rows = await db(`workshop_applications?reference=eq.${enc(reference)}&select=country,currency,project_goal`);
  return rows[0] || null;
}

// ---------- Questions ----------
const MAX_PER_DAY = 8;
export async function askQuestion(member, question, link, now = new Date()) {
  const q = String(question || '').trim();
  const l = String(link || '').trim();
  if (q.length < 5) return { ok: false, error: 'Write your question in a sentence or two.' };
  if (q.length > 1500) return { ok: false, error: 'Keep it under 1,500 characters. Split it into two questions if you need to.' };
  if (l && !/^https?:\/\/\S{3,300}$/.test(l)) return { ok: false, error: 'That link needs to start with https://' };
  const since = new Date(now.getTime() - 864e5).toISOString();
  const recent = await db(`workshop_kit_questions?reference=eq.${enc(member.reference)}&created_at=gte.${enc(since)}&select=id`);
  if (recent.length >= MAX_PER_DAY) return { ok: false, error: "That's 8 questions today, the daily limit. Post anything urgent in the WhatsApp group." };
  const rows = await db('workshop_kit_questions', { method: 'POST', prefer: 'return=representation', body: { reference: member.reference, question: q, build_link: l || null } });
  return { ok: true, question: publicQuestion(rows[0]) };
}
export const publicQuestion = (r) => ({ id: r.id, question: r.question, build_link: r.build_link, status: r.status, answer: r.status === 'pending' ? null : r.answer, created_at: r.created_at, answered_at: r.answered_at });
export async function myQuestions(reference) {
  const rows = await db(`workshop_kit_questions?reference=eq.${enc(reference)}&select=id,question,build_link,status,answer,created_at,answered_at&order=created_at.desc&limit=40`);
  return rows.map(publicQuestion);
}
// Hand pending questions to the agent. A claim lasts 20 minutes, so a run that dies doesn't strand a question.
export async function claimPending(now = new Date()) {
  const stale = new Date(now.getTime() - 20 * 60000).toISOString();
  const rows = await db(`workshop_kit_questions?status=eq.pending&or=(claimed_at.is.null,claimed_at.lt.${enc(stale)})&select=id,reference,question,build_link,created_at&order=created_at&limit=20`);
  if (rows.length) await db(`workshop_kit_questions?id=in.(${rows.map((r) => r.id).join(',')})`, { method: 'PATCH', body: { claimed_at: now.toISOString() } });
  return rows;
}
export async function previousQA(reference, excludeId) {
  const rows = await db(`workshop_kit_questions?reference=eq.${enc(reference)}&status=neq.pending&id=neq.${excludeId}&select=question,answer,answered_at&order=created_at.desc&limit=3`);
  return rows;
}
export async function getQuestion(id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null;
  const rows = await db(`workshop_kit_questions?id=eq.${id}&select=*`);
  return rows[0] || null;
}
export async function saveAnswer(id, answer, escalate, now = new Date()) {
  await db(`workshop_kit_questions?id=eq.${id}`, { method: 'PATCH', body: { answer, status: escalate ? 'escalated' : 'answered', answered_at: now.toISOString() } });
}

// ---------- Feedback forms ----------
export async function formToken(reference, form) {
  const token = crypto.randomBytes(24).toString('base64url');
  await db('workshop_form_tokens', { method: 'POST', body: { token_hash: sha(token), reference, form, expires_at: '2027-01-01T00:00:00Z' } });
  return token;
}
export async function resolveFormToken(token, now = new Date()) {
  const t = String(token || '');
  if (t.length < 20 || t.length > 80) return null;
  const rows = await db(`workshop_form_tokens?token_hash=eq.${sha(t)}&select=reference,form,expires_at`);
  const r = rows[0];
  return r && new Date(r.expires_at) > now ? r : null;
}
export async function getFeedback(reference, form) {
  const rows = await db(`workshop_feedback?reference=eq.${enc(reference)}&form=eq.${form}&select=answers,updated_at`);
  return rows[0] || null;
}
export async function feedbackDone(reference) {
  const rows = await db(`workshop_feedback?reference=eq.${enc(reference)}&select=form`);
  return new Set(rows.map((r) => r.form));
}

const pick = (v, list) => (list.includes(v) ? v : null);
const text = (v, max) => String(v || '').trim().slice(0, max);
const PAY_GBP = ['Under £50', '£50 to £100', '£100 to £200', '£200 or more'];
const PAY_NGN = ['Under ₦50,000', '₦50,000 to ₦100,000', '₦100,000 to ₦200,000', '₦200,000 or more'];
const TOPICS = ['Real data behind my build', 'My own domain and launch', 'Taking payments', 'Automations', 'AI agents', 'Design systems', 'Claude for business'];
const VC_PARTS = ['Studio', 'Editor', 'Effects', 'Brand'];
const DEVICES = ['Laptop or desktop', 'Tablet', 'Phone'];

export function cleanAnswers(form, a = {}) {
  if (form === 'workshop') {
    const rating = Number(a.rating);
    const out = {
      rating: Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null,
      change: text(a.change, 1200),
      best: text(a.best, 1200),
      advanced: pick(a.advanced, ['Yes', 'Maybe', 'No']),
      topics: Array.isArray(a.topics) ? a.topics.filter((t) => TOPICS.includes(t)).slice(0, 7) : [],
      topics_other: text(a.topics_other, 300),
      pay: pick(a.pay, [...PAY_GBP, ...PAY_NGN]),
      quote: text(a.quote, 400),
      quote_ok: a.quote_ok === true,
    };
    if (!out.rating) return { error: 'Pick a rating from 1 to 10.' };
    if (out.change.length < 3) return { error: 'Tell me the one thing you would change.' };
    if (!out.advanced) return { error: 'Say whether you would join an advanced session.' };
    if (out.advanced !== 'No' && !out.pay) return { error: 'Pick what you would pay for an advanced session.' };
    return { answers: out };
  }
  if (form === 'voidcanvas') {
    const rating = Number(a.rating);
    const out = {
      parts: Array.isArray(a.parts) ? a.parts.filter((p) => VC_PARTS.includes(p)) : [],
      rating: Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null,
      broke: text(a.broke, 2000),
      missing: text(a.missing, 2000),
      client_work: pick(a.client_work, ['Yes, today', 'After some fixes', 'Not yet']),
      device: pick(a.device, DEVICES),
      browser: text(a.browser, 80),
    };
    if (!out.parts.length) return { error: 'Tick the parts you tried.' };
    if (!out.rating) return { error: 'Pick a rating from 1 to 10.' };
    if (out.broke.length < 3) return { error: 'Tell me what broke or confused you. "Nothing" is a fine answer.' };
    return { answers: out };
  }
  return { error: 'Unknown form.' };
}
export async function saveFeedback(reference, form, answers, now = new Date()) {
  await db('workshop_feedback?on_conflict=reference,form', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { reference, form, answers, updated_at: now.toISOString() } });
}
export const FORM_OPTIONS = { PAY_GBP, PAY_NGN, TOPICS, VC_PARTS, DEVICES };

// ---------- Kit updates ----------
// Updates for everyone (cohort_ids null) plus those aimed at this cohort.
export async function publishedUpdates(now = new Date(), cohortId = null) {
  const who = cohortId ? `&or=${enc(`(cohort_ids.is.null,cohort_ids.cs.{${cohortId}})`)}` : '&cohort_ids=is.null';
  return db(`workshop_kit_updates?publish_at=lte.${enc(now.toISOString())}${who}&select=id,title,items,publish_at&order=publish_at.desc&limit=10`);
}
export async function getUpdate(id) {
  const rows = await db(`workshop_kit_updates?id=eq.${enc(id)}&select=id,title,items,publish_at`);
  return rows[0] || null;
}

// ---------- Mailings log ----------
export async function mailed(kind) {
  const rows = await db(`workshop_kit_mailings?kind=eq.${enc(kind)}&select=reference,resend_id,sent_at`);
  return new Map(rows.map((r) => [r.reference, r]));
}
export async function logMailing(kind, reference, email, resendId) {
  await db('workshop_kit_mailings', { method: 'POST', body: { kind, reference, email, resend_id: resendId } });
}

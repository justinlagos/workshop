// GET  /kit                      : the kit for a signed-in member, otherwise the sign-in page
// POST /api/kit-start  {reference} : email a 6-digit code ({preview:true} checks the reference only)
// POST /api/kit-verify {reference, code} : check the code, start a session
// POST /api/kit-logout             : end this device's session
// GET  /kit/deck.pdf               : the Saturday deck, members only
// GET/POST /api/kit-ask            : your questions / ask a new one (members)
// GET  /feedback?form=&t=          : a feedback form, by session or by the token link in an email
// POST /api/kit-form               : save a feedback form
// POST /api/kit-mail {mode, kind}  : host only. list / proof / schedule / cancel / send / copy
// Asking a question also refreshes workshop_kit_knowledge, which the kit assistant answers from.
// One function on purpose: the Vercel Hobby plan allows 12 functions per deployment.
import fs from 'node:fs';
import { method, mail, db } from './_shared.js';
import { currentMember, kitOpen, findMember, issueCode, maskEmail, checkCode, createSession, sessionCookie, endSession, clearCookie } from '../lib/kit.js';
import { kitCodeEmail, firstName, followUpEmail, kitUpdateEmail, feedbackEmail, vcTesterEmail, adminFeedbackEmail } from '../lib/kit-emails.js';
import { esc } from '../lib/emails.js';
import { knowledge } from '../lib/kit-knowledge.js';
import {
  askOpen, askQuestion, myQuestions, attendees, hostMember, applicationFor, HOST_REF, DESIGNERS, FORMS,
  formToken, resolveFormToken, getFeedback, feedbackDone, cleanAnswers, saveFeedback, FORM_OPTIONS,
  publishedUpdates, getUpdate, mailed, logMailing,
} from '../lib/kit-data.js';

const KIT = fs.readFileSync(new URL('../private/kit.html', import.meta.url), 'utf8');
const GATE = fs.readFileSync(new URL('../private/kit-gate.html', import.meta.url), 'utf8');
const FORM = fs.readFileSync(new URL('../private/form.html', import.meta.url), 'utf8');
const FILES = {
  deck: { url: new URL('../private/the-build-session-cohort-01.pdf', import.meta.url), name: 'The-Build-Session-Cohort-01.pdf', type: 'application/pdf' },
};
const CLOSED = { ok: false, error: 'The Cohort 01 kit closed on 31 December 2026.' };
const FROM = 'Justin at MotionPlay Labs <hello@motionplaylabs.com>';
const BASE = 'https://workshop.motionplaylabs.com';
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
const shortDate = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

function updatesHtml(updates) {
  if (!updates.length) return '<p class="muted">Nothing new yet. Updates land here, and you get a short email each time.</p>';
  const one = (u, open) => {
    const items = (u.items || []).map((i) => `<li><a href="#${esc(i.view || 'home')}">${esc(i.title)}</a><span>${esc(i.text)}</span></li>`).join('');
    const body = `<ul class="u-items">${items}</ul>`;
    return open
      ? `<article class="update"><p class="u-date">${esc(shortDate(u.publish_at))} · Latest</p><h3>${esc(u.title)}</h3>${body}</article>`
      : `<details class="update older"><summary><span class="u-date">${esc(shortDate(u.publish_at))}</span> ${esc(u.title)}</summary>${body}</details>`;
  };
  return updates.map((u, i) => one(u, i === 0)).join('');
}

function feedbackCard(done) {
  return done
    ? `<a class="action done" href="/feedback?form=workshop"><span class="a-k">FEEDBACK</span><strong>Thanks, your feedback is in</strong><span>Change your answers any time.</span></a>`
    : `<a class="action" href="/feedback?form=workshop"><span class="a-k">TWO MINUTES</span><strong>How was Saturday?</strong><span>Four questions that shape the next session.</span></a>`;
}

async function page(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');
  let member = null;
  try { member = await currentMember(req); } catch (e) { console.error('kit session check failed:', e.message); }
  if (!member) return res.status(200).send(kitOpen() ? GATE : GATE.replace('data-state="open"', 'data-state="closed"'));
  let updates = [], done = new Set();
  try { [updates, done] = await Promise.all([publishedUpdates(), feedbackDone(member.reference)]); } catch (e) { console.error('kit extras failed:', e.message); }
  const designer = DESIGNERS.includes(member.reference) || member.role === 'host';
  return res.status(200).send(KIT
    .replace('<body>', `<body data-ask="${askOpen() ? 'open' : 'closed'}" data-designer="${designer ? '1' : '0'}" data-vc-done="${done.has('voidcanvas') ? '1' : '0'}">`)
    .replace('{{UPDATES}}', updatesHtml(updates))
    .replace('{{FEEDBACK_CARD}}', feedbackCard(done.has('workshop')))
    .replaceAll('{{FIRST}}', esc(firstName(member)))
    .replaceAll('{{NAME}}', esc(member.full_name))
    .replaceAll('{{REF}}', esc(member.reference)));
}

async function start(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!kitOpen()) return res.status(410).json(CLOSED);
  const b = req.body || {};
  let member;
  try { member = await findMember(b.reference); }
  catch (e) { console.error('kit lookup failed:', e.message); return res.status(503).json({ ok: false, error: "We can't check references right now. Try again in a minute." }); }
  if (!member) return res.status(404).json({ ok: false, error: "We couldn't find that reference. It starts with TBS- and it's in your booking emails from MotionPlay Labs." });
  const to = maskEmail(member.email);
  if (b.preview === true) return res.status(200).json({ ok: true, preview: true, to });
  try {
    const r = await issueCode(member.reference);
    if (r.status === 'limited') return res.status(429).json({ ok: false, error: 'Too many codes requested today. Email hello@motionplaylabs.com and we will let you in.' });
    if (r.status === 'recent') return res.status(200).json({ ok: true, sent: false, to, wait: 60 });
    const sent = await mail(member.email, kitCodeEmail(member, r.code));
    if (!sent.sent) throw new Error('Email not configured');
    return res.status(200).json({ ok: true, sent: true, to });
  } catch (e) {
    console.error('kit code send failed:', e.message);
    return res.status(503).json({ ok: false, error: "We couldn't send your code just now. Try again in a minute." });
  }
}

const MESSAGES = {
  wrong: "That code doesn't match. Check the most recent email from us.",
  expired: 'That code has expired. Send yourself a new one.',
  locked: 'Too many tries with that code. Send yourself a new one.',
  none: 'Send yourself a code first.',
};

async function verify(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!kitOpen()) return res.status(410).json(CLOSED);
  const b = req.body || {};
  const code = String(b.code || '').replace(/\D/g, '');
  try {
    const member = await findMember(b.reference);
    if (!member) return res.status(404).json({ ok: false, error: "We couldn't find that reference." });
    const r = await checkCode(member.reference, code);
    if (!r.ok) return res.status(400).json({ ok: false, reason: r.reason, error: MESSAGES[r.reason] });
    const token = await createSession(member.reference);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('kit verify failed:', e.message);
    return res.status(503).json({ ok: false, error: "We couldn't check your code just now. Try again in a minute." });
  }
}

async function logout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  await endSession(req);
  res.setHeader('Set-Cookie', clearCookie());
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 303;
  res.setHeader('Location', '/kit');
  return res.end();
}

async function file(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const f = FILES[String(req.query?.f || 'deck')];
  let member = null;
  try { member = await currentMember(req); } catch (e) { console.error('kit file session check failed:', e.message); }
  if (!member || !f) { res.statusCode = 302; res.setHeader('Location', '/kit'); return res.end(); }
  let buf;
  try { buf = fs.readFileSync(f.url); } catch { return res.status(404).send('File not found'); }
  res.setHeader('Content-Type', f.type);
  res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
  res.setHeader('Content-Length', buf.length);
  return res.status(200).send(buf);
}

// ---------- Ask a question ----------
async function ask(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let member = null;
  try { member = await currentMember(req); } catch (e) { console.error('ask session check failed:', e.message); }
  if (!member) return res.status(401).json({ ok: false, error: 'Your session has ended. Reload the page to sign in again.' });
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true, open: askOpen(), questions: await myQuestions(member.reference) });
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    if (!askOpen()) return res.status(410).json({ ok: false, error: 'The Ask box closed with the support window on 14 November.' });
    const b = req.body || {};
    const r = await askQuestion(member, b.question, b.link);
    if (r.ok) await syncKnowledge().catch((e) => console.error('knowledge sync failed:', e.message));
    return res.status(r.ok ? 201 : 400).json(r);
  } catch (e) {
    console.error('ask failed:', e.message);
    return res.status(503).json({ ok: false, error: "We couldn't save that just now. Try again in a minute." });
  }
}

// Keep the assistant's sources in step with the deployed kit.
const KNOWLEDGE = knowledge();
async function syncKnowledge() {
  const rows = await db('workshop_kit_knowledge?id=eq.kit&select=hash');
  if (rows[0]?.hash === KNOWLEDGE.hash) return;
  await db('workshop_kit_knowledge?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { id: 'kit', body: KNOWLEDGE.body, hash: KNOWLEDGE.hash, updated_at: new Date().toISOString() } });
}

// ---------- Feedback forms ----------
async function formAuth(req, form, token) {
  if (token) {
    const t = await resolveFormToken(token);
    if (t && (!form || t.form === form)) return { member: await findMember(t.reference), form: t.form, via: 'token' };
  }
  const member = await currentMember(req);
  if (member && FORMS.includes(form)) return { member, form, via: 'session' };
  return null;
}

async function feedbackPage(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const form = FORMS.includes(String(req.query?.form)) ? String(req.query.form) : null;
  const token = String(req.query?.t || '');
  let auth = null;
  try { auth = await formAuth(req, form, token); } catch (e) { console.error('feedback auth failed:', e.message); }
  if (!auth || !auth.member) {
    return res.status(200).send(FORM.replace('/*CONFIG*/null', scriptJson({ state: 'expired' })));
  }
  let existing = null, app = null;
  try { [existing, app] = await Promise.all([getFeedback(auth.member.reference, auth.form), applicationFor(auth.member.reference)]); } catch (e) { console.error('feedback load failed:', e.message); }
  const currency = app?.currency === 'NGN' ? 'NGN' : 'GBP';
  const config = {
    state: 'open', form: auth.form, token: auth.via === 'token' ? token : null, first: firstName(auth.member),
    answers: existing?.answers || null,
    options: { pay: currency === 'NGN' ? FORM_OPTIONS.PAY_NGN : FORM_OPTIONS.PAY_GBP, topics: FORM_OPTIONS.TOPICS, parts: FORM_OPTIONS.VC_PARTS, devices: FORM_OPTIONS.DEVICES },
  };
  return res.status(200).send(FORM.replace('/*CONFIG*/null', scriptJson(config)));
}

async function formSave(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  const b = req.body || {};
  const form = FORMS.includes(String(b.form)) ? String(b.form) : null;
  let auth = null;
  try { auth = await formAuth(req, form, b.token ? String(b.token) : ''); } catch (e) { console.error('form auth failed:', e.message); }
  if (!auth || !auth.member || auth.form !== form) return res.status(401).json({ ok: false, error: 'This link has expired. Sign in to your kit and open the form from there.' });
  const c = cleanAnswers(form, b.answers || {});
  if (c.error) return res.status(400).json({ ok: false, error: c.error });
  try {
    await saveFeedback(auth.member.reference, form, c.answers);
  } catch (e) {
    console.error('feedback save failed:', e.message);
    return res.status(503).json({ ok: false, error: "We couldn't save that just now. Try again in a minute." });
  }
  try {
    const host = await hostMember();
    if (host && auth.member.reference !== HOST_REF) await mail(host.email, adminFeedbackEmail(auth.member, form, c.answers));
  } catch (e) { console.error('feedback host email failed:', e.message); }
  return res.status(200).json({ ok: true });
}

// ---------- Host mailer ----------
async function resendSend(to, msg, { scheduledAt, attachments, idempotencyKey } = {}) {
  const body = { from: FROM, to: [to], subject: msg.subject, html: msg.html, text: msg.text };
  if (scheduledAt) body.scheduled_at = scheduledAt;
  if (attachments) body.attachments = attachments;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Resend ' + r.status + ': ' + (j.message || j.name || 'send failed'));
  return j.id;
}
const deckAttachment = () => [{ filename: FILES.deck.name, content: fs.readFileSync(FILES.deck.url).toString('base64') }];

// Who gets each kind of email, and what it says. The host always gets their own copy.
async function recipients(kind) {
  const [list, host] = await Promise.all([attendees(), hostMember()]);
  const people = kind === 'vctest' ? list.filter((a) => DESIGNERS.includes(a.reference)) : list;
  return host ? [...people, host] : people;
}
async function compose(kind, member, tokenRef = member.reference) {
  if (kind === 'feedback') return { msg: feedbackEmail(member, `${BASE}/feedback?t=${await formToken(tokenRef, 'workshop')}`) };
  if (kind === 'vctest') return { msg: vcTesterEmail(member, `${BASE}/feedback?t=${await formToken(tokenRef, 'voidcanvas')}`) };
  if (kind.startsWith('update:')) {
    const u = await getUpdate(kind.slice(7));
    if (!u) throw new Error('No such update');
    return { msg: kitUpdateEmail(member, u) };
  }
  if (kind === 'followup') return { msg: followUpEmail(member), attachments: deckAttachment() };
  throw new Error('Unknown kind');
}
const KINDS = /^(feedback|vctest|followup|update:[a-z0-9-]{3,60})$/;
const mailKind = (k) => (k === 'followup' ? 'followup-2026-10-cohort01' : k);

async function kitMail(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  let host = null;
  try { host = await currentMember(req); } catch (e) { console.error('kit mail session check failed:', e.message); }
  if (!host || host.role !== 'host') return res.status(403).json({ ok: false, error: 'Host only.' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ ok: false, error: 'Email is not configured.' });
  const b = req.body || {};
  const kind = String(b.kind || 'followup');
  if (!KINDS.test(kind)) return res.status(400).json({ ok: false, error: 'Unknown kind' });
  const logKind = mailKind(kind);
  try {
    const people = await recipients(kind);
    const log = await mailed(logKind);
    if (b.mode === 'list') {
      return res.status(200).json({ ok: true, kind, recipients: people.map((p) => ({ reference: p.reference, name: p.full_name, to: maskEmail(p.email), mailed: log.get(p.reference) || null })) });
    }
    if (b.mode === 'proof') {
      const as = people.find((p) => p.reference === b.as) || people[0];
      const { msg, attachments } = await compose(kind, as, HOST_REF);
      const id = await resendSend(host.email, { ...msg, subject: '[Proof as ' + firstName(as) + '] ' + msg.subject }, { attachments });
      return res.status(200).json({ ok: true, proof: true, as: as.reference, id });
    }
    if (b.mode === 'schedule' || b.mode === 'send') {
      const at = b.mode === 'schedule' ? String(b.at || '') : null;
      if (b.mode === 'schedule' && !(Date.parse(at) > Date.now() + 60000)) return res.status(400).json({ ok: false, error: 'at must be a future ISO time' });
      const only = b.only ? String(b.only) : null;
      const todo = people.filter((p) => !log.has(p.reference) && (!only || p.reference === only));
      const results = [];
      for (const p of todo) {
        try {
          const { msg, attachments } = await compose(kind, p);
          const id = await resendSend(p.email, msg, { scheduledAt: at || undefined, attachments, idempotencyKey: logKind + '-' + p.reference });
          await logMailing(logKind, p.reference, p.email, id);
          results.push({ reference: p.reference, ok: true, id, at });
        } catch (e) { console.error('mail failed', kind, p.reference, e.message); results.push({ reference: p.reference, ok: false, error: e.message }); }
      }
      return res.status(200).json({ ok: results.every((r) => r.ok), kind, results, skipped: people.filter((p) => log.has(p.reference)).map((p) => p.reference) });
    }
    if (b.mode === 'cancel') {
      const results = [];
      for (const [ref, row] of log) {
        if (b.only && ref !== b.only) continue;
        const r = await fetch(`https://api.resend.com/emails/${row.resend_id}/cancel`, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY } });
        if (r.ok) await db(`workshop_kit_mailings?kind=eq.${encodeURIComponent(logKind)}&reference=eq.${encodeURIComponent(ref)}`, { method: 'DELETE' });
        results.push({ reference: ref, cancelled: r.ok, status: r.status });
      }
      return res.status(200).json({ ok: true, kind, results });
    }
    if (b.mode === 'copy' && kind === 'followup') {
      const id = await resendSend(host.email, followUpEmail(host), { attachments: deckAttachment(), idempotencyKey: 'copy-' + host.reference + '-' + Date.now() });
      return res.status(200).json({ ok: true, copy: true, id });
    }
    return res.status(400).json({ ok: false, error: "mode must be 'list', 'proof', 'schedule', 'send', 'cancel' or 'copy'" });
  } catch (e) {
    console.error('kit mail failed:', e.message);
    return res.status(502).json({ ok: false, error: e.message });
  }
}

const ACTIONS = { start, verify, logout, file, mail: kitMail, ask, form: formSave, feedback: feedbackPage };

export default async function handler(req, res) {
  const action = ACTIONS[String(req.query?.action || '')];
  return action ? action(req, res) : page(req, res);
}

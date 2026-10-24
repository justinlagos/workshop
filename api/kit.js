// GET  /kit                      : the kit for a signed-in member, otherwise the sign-in page
// POST /api/kit-start  {reference} : email a 6-digit code ({preview:true} checks the reference only)
// POST /api/kit-verify {reference, code} : check the code, start a session
// POST /api/kit-logout             : end this device's session
// GET  /kit/deck.pdf               : the Saturday deck, members only
// One function on purpose: the Vercel Hobby plan allows 12 functions per deployment.
import fs from 'node:fs';
import { method, mail } from './_shared.js';
import { currentMember, kitOpen, findMember, issueCode, maskEmail, checkCode, createSession, sessionCookie, endSession, clearCookie } from '../lib/kit.js';
import { kitCodeEmail, firstName } from '../lib/kit-emails.js';
import { esc } from '../lib/emails.js';

const KIT = fs.readFileSync(new URL('../private/kit.html', import.meta.url), 'utf8');
const GATE = fs.readFileSync(new URL('../private/kit-gate.html', import.meta.url), 'utf8');
const FILES = {
  deck: { url: new URL('../private/the-build-session-cohort-01.pdf', import.meta.url), name: 'The-Build-Session-Cohort-01.pdf', type: 'application/pdf' },
};
const CLOSED = { ok: false, error: 'The Cohort 01 kit closed on 31 December 2026.' };

async function page(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');
  let member = null;
  try { member = await currentMember(req); } catch (e) { console.error('kit session check failed:', e.message); }
  if (!member) return res.status(200).send(kitOpen() ? GATE : GATE.replace('data-state="open"', 'data-state="closed"'));
  return res.status(200).send(KIT
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

const ACTIONS = { start, verify, logout, file };

export default async function handler(req, res) {
  const action = ACTIONS[String(req.query?.action || '')];
  return action ? action(req, res) : page(req, res);
}

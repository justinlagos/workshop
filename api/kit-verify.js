// POST /api/kit-verify {reference, code} : check the emailed code and start a kit session.
import { method } from './_shared.js';
import { findMember, checkCode, createSession, sessionCookie, kitOpen } from '../lib/kit.js';

const MESSAGES = {
  wrong: "That code doesn't match. Check the most recent email from us.",
  expired: 'That code has expired. Send yourself a new one.',
  locked: 'Too many tries with that code. Send yourself a new one.',
  none: 'Send yourself a code first.',
};

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!kitOpen()) return res.status(410).json({ ok: false, error: 'The Cohort 01 kit closed on 31 December 2026.' });
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

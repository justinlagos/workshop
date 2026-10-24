// POST /api/kit-start {reference} : email a 6-digit sign-in code to the booking's address.
// {reference, preview:true} checks the reference and returns the masked address without sending anything.
import { method, mail } from './_shared.js';
import { findMember, issueCode, kitOpen, maskEmail } from '../lib/kit.js';
import { kitCodeEmail } from '../lib/kit-emails.js';

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!kitOpen()) return res.status(410).json({ ok: false, error: 'The Cohort 01 kit closed on 31 December 2026.' });
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

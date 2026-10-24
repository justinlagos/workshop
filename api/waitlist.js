// POST /api/waitlist {fullName, email, interest} : first access to the next Build Session.
import { db, mail, adminEmail, configured, method } from './_shared.js';
import { esc } from '../lib/emails.js';

const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ ok: false, error: 'The list is not open yet.' });
  const b = req.body || {};
  if (b.company_website) return res.status(400).json({ ok: false, error: 'Invalid submission' });
  const fullName = String(b.fullName || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  const interest = String(b.interest || '').trim().slice(0, 300);
  if (fullName.length < 2 || !validEmail(email)) return res.status(400).json({ ok: false, error: 'Add your name and a valid email address.' });
  try {
    await db('workshop_waitlist?on_conflict=email', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: { full_name: fullName, email, interest: interest || null } });
  } catch (e) {
    console.error('waitlist insert failed:', e.message);
    return res.status(503).json({ ok: false, error: "We couldn't save that just now. Try again in a minute." });
  }
  try {
    await mail(adminEmail(), { subject: 'Build Session waitlist: ' + fullName, text: `${fullName}\n${email}\n${interest || '(no build idea given)'}`, html: `<div style="font-family:Arial;max-width:540px"><p><b>${esc(fullName)}</b><br>${esc(email)}</p><p>${esc(interest || '(no build idea given)')}</p></div>` });
  } catch (e) { console.error('waitlist admin email failed:', e.message); }
  return res.status(201).json({ ok: true });
}

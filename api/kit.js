// GET /kit : the Cohort 01 kit for a signed-in attendee, otherwise the sign-in page.
import fs from 'node:fs';
import { currentMember, kitOpen } from '../lib/kit.js';
import { firstName } from '../lib/kit-emails.js';
import { esc } from '../lib/emails.js';

const KIT = fs.readFileSync(new URL('../private/kit.html', import.meta.url), 'utf8');
const GATE = fs.readFileSync(new URL('../private/kit-gate.html', import.meta.url), 'utf8');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');
  let member = null;
  try { member = await currentMember(req); } catch (e) { console.error('kit session check failed:', e.message); }
  if (!member) return res.status(200).send(GATE.replace('data-state="open"', kitOpen() ? 'data-state="open"' : 'data-state="closed"'));
  const html = KIT
    .replaceAll('{{FIRST}}', esc(firstName(member)))
    .replaceAll('{{NAME}}', esc(member.full_name))
    .replaceAll('{{REF}}', esc(member.reference));
  return res.status(200).send(html);
}

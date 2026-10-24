// GET /kit/deck.pdf : the Saturday deck, for signed-in kit members only.
import fs from 'node:fs';
import { currentMember } from '../lib/kit.js';

const FILES = {
  deck: { url: new URL('../private/the-build-session-cohort-01.pdf', import.meta.url), name: 'The-Build-Session-Cohort-01.pdf', type: 'application/pdf' },
};

export default async function handler(req, res) {
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

// POST /api/kit-logout : end this device's kit session.
import { endSession, clearCookie } from '../lib/kit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  await endSession(req);
  res.setHeader('Set-Cookie', clearCookie());
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 303;
  res.setHeader('Location', '/kit');
  return res.end();
}

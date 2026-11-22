// Daily check on the database, run by Vercel Cron (see "crons" in vercel.json).
// Supabase pauses free projects after a week without activity, which takes the kit sign-in,
// booking form and seat counts down with it. This read counts as activity, and if the database
// does not answer, Justin gets one email a day until it does.
import { db, mail, adminEmail, configured } from './_shared.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  if (!configured()) return res.status(503).json({ ok: false, db: 'not configured' });
  try {
    const rows = await db('workshop_cohorts?select=id&limit=1');
    if (!Array.isArray(rows)) throw new Error('Unexpected reply');
    return res.status(200).json({ ok: true, db: 'up', at: new Date().toISOString() });
  } catch (e) {
    console.error('keepalive: database not answering:', e.message);
    try {
      await mail(adminEmail(), {
        subject: 'Workshop database is not answering',
        text: [
          'The daily check could not reach the workshop database.',
          '',
          'While it is down, kit sign-in, the booking form and seat counts do not work.',
          '',
          'If Supabase has paused it: supabase.com/dashboard > Workshop project > Restore project. It takes about five minutes.',
          '',
          `Error: ${e.message}`,
        ].join('\n'),
      });
    } catch (m) { console.error('keepalive: alert email failed:', m.message); }
    return res.status(503).json({ ok: false, db: 'down' });
  }
}

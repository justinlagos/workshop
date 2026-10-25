// POST /api/kit-agent {action:'notify', id}
// Called by the database (pg_net trigger) when the kit assistant saves an answer.
// Emails the answer to the asker and a copy to the host. Each answer is sent once (notified_at),
// so the endpoint needs no secret: calling it again, or for any other id, sends nothing.
// The assistant itself reads and writes questions through Supabase: workshop_kit_claim_pending()
// and workshop_kit_answer(); its sources are in workshop_kit_knowledge.
import { db, mail } from './_shared.js';
import { findMember } from '../lib/kit.js';
import { hostMember } from '../lib/kit-data.js';
import { answerEmail, adminAnswerEmail } from '../lib/kit-emails.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const b = req.body || {};
  if (b.action !== 'notify' || !/^[0-9a-f-]{36}$/.test(String(b.id || ''))) return res.status(400).json({ ok: false, error: 'Bad request' });
  try {
    // Claim the send: only the first call for an answered, unsent question gets a row back.
    const rows = await db(`workshop_kit_questions?id=eq.${b.id}&notified_at=is.null&status=in.(answered,escalated)`, {
      method: 'PATCH', prefer: 'return=representation', body: { notified_at: new Date().toISOString() },
    });
    const q = rows[0];
    if (!q) return res.status(200).json({ ok: true, sent: false });
    const member = await findMember(q.reference);
    let sent = false;
    if (member) {
      try { sent = (await mail(member.email, answerEmail(member, q))).sent; }
      catch (e) {
        console.error('answer email failed:', e.message);
        await db(`workshop_kit_questions?id=eq.${q.id}`, { method: 'PATCH', body: { notified_at: null } }).catch(() => {});
        return res.status(502).json({ ok: false, error: 'Email failed' });
      }
      const host = await hostMember().catch(() => null);
      if (host) await mail(host.email, adminAnswerEmail(member, q, q.note_for_justin)).catch((e) => console.error('host copy failed:', e.message));
    }
    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error('notify failed:', e.message);
    return res.status(503).json({ ok: false, error: 'Unavailable' });
  }
}

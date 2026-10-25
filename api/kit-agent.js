// The kit assistant's endpoint. A scheduled Claude agent calls it with a bearer token:
//   GET  /api/kit-agent?action=pending  -> unanswered questions (claimed for 20 min), the kit text, facts and answer rules
//   POST /api/kit-agent {action:'answer', id, answer, escalate, note_for_justin}
//        -> saves the answer, emails it to the asker, and sends Justin a copy
import crypto from 'node:crypto';
import { db, mail } from './_shared.js';
import { findMember } from '../lib/kit.js';
import { claimPending, previousQA, applicationFor, getQuestion, saveAnswer, hostMember, askOpen } from '../lib/kit-data.js';
import { answerEmail, adminAnswerEmail, firstName } from '../lib/kit-emails.js';
import { kitText, FACTS, ANSWER_RULES } from '../lib/kit-knowledge.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

async function authorised(req) {
  const h = String(req.headers?.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (token.length < 30) return false;
  const rows = await db('workshop_kit_secrets?name=eq.agent&select=token_hash');
  const want = rows[0]?.token_hash;
  if (!want) return false;
  const a = Buffer.from(sha(token)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!(await authorised(req))) return res.status(401).json({ ok: false, error: 'Unauthorised' });
  } catch (e) {
    console.error('agent auth failed:', e.message);
    return res.status(503).json({ ok: false, error: 'Auth check unavailable' });
  }
  const action = String(req.query?.action || req.body?.action || '');

  if (req.method === 'GET' && action === 'pending') {
    const rows = await claimPending();
    const questions = [];
    for (const r of rows) {
      const member = await findMember(r.reference);
      const app = await applicationFor(r.reference).catch(() => null);
      questions.push({
        id: r.id,
        asked_at: r.created_at,
        first_name: member ? firstName(member) : 'there',
        role: member?.role || 'attendee',
        country: app?.country || null,
        their_build: app?.project_goal || null,
        question: r.question,
        build_link: r.build_link,
        earlier_questions_from_them: await previousQA(r.reference, r.id).catch(() => []),
      });
    }
    return res.status(200).json({
      ok: true,
      now: new Date().toISOString(),
      ask_open: askOpen(),
      count: questions.length,
      questions,
      ...(questions.length ? { answer_rules: ANSWER_RULES, facts: FACTS, kit: kitText() } : {}),
    });
  }

  if (req.method === 'POST' && action === 'answer') {
    const b = req.body || {};
    const q = await getQuestion(b.id);
    if (!q) return res.status(404).json({ ok: false, error: 'No such question' });
    if (q.status !== 'pending') return res.status(409).json({ ok: false, error: 'Already answered' });
    const answer = String(b.answer || '').trim();
    if (answer.length < 10 || answer.length > 6000) return res.status(400).json({ ok: false, error: 'Answer must be 10 to 6000 characters' });
    if (/—/.test(answer)) return res.status(400).json({ ok: false, error: 'Remove em dashes from the answer' });
    const escalate = b.escalate === true;
    const note = String(b.note_for_justin || '').trim().slice(0, 1000);
    await saveAnswer(q.id, answer, escalate);
    const saved = { ...q, answer, status: escalate ? 'escalated' : 'answered' };
    const member = await findMember(q.reference);
    let emailed = false;
    try {
      if (member) emailed = (await mail(member.email, answerEmail(member, saved))).sent;
      const host = await hostMember();
      if (host && member) await mail(host.email, adminAnswerEmail({ ...member, email: member.email }, saved, note));
    } catch (e) { console.error('answer email failed:', e.message); }
    return res.status(200).json({ ok: true, id: q.id, status: saved.status, emailed });
  }

  if (req.method === 'GET' && action === 'health') return res.status(200).json({ ok: true });
  return res.status(400).json({ ok: false, error: "Use GET ?action=pending or POST {action:'answer'}" });
}

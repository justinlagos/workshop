// Cohort 01 kit access: booking reference -> 6-digit code by email -> server-side session cookie.
// All state lives in Supabase (service role only): workshop_kit_codes, workshop_kit_sessions,
// workshop_kit_members, and the workshop_kit_member() lookup over paid bookings.
import crypto from 'node:crypto';
import { db, rpc } from '../api/_shared.js';

export const KIT_CLOSES = new Date('2027-01-01T00:00:00Z'); // end of Thu 31 Dec 2026, UK time
export const COOKIE = 'tbs_kit';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;
const MAX_CODES_PER_DAY = 6;
const MAX_ATTEMPTS = 5;

export const kitOpen = (now = new Date()) => now < KIT_CLOSES;
export const normRef = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return 'your email';
  const keep = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2);
  return keep + '•'.repeat(Math.max(3, Math.min(8, user.length - keep.length))) + '@' + domain;
}

export async function findMember(reference) {
  const ref = normRef(reference);
  if (!/^TBS-[A-Z0-9-]{4,30}$/.test(ref)) return null;
  const rows = await rpc('workshop_kit_member', { p_reference: ref });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Returns { status: 'sent' | 'recent' | 'limited', code? }. Only 'sent' carries a new code to email.
export async function issueCode(reference, now = new Date()) {
  const since = new Date(now.getTime() - 864e5).toISOString();
  const recent = await db(`workshop_kit_codes?reference=eq.${encodeURIComponent(reference)}&created_at=gte.${encodeURIComponent(since)}&select=created_at&order=created_at.desc&limit=${MAX_CODES_PER_DAY}`);
  if (recent.length && now - new Date(recent[0].created_at) < RESEND_GAP_MS) return { status: 'recent' };
  if (recent.length >= MAX_CODES_PER_DAY) return { status: 'limited' };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // Any earlier unused code for this reference stops working once a new one is issued.
  await db(`workshop_kit_codes?reference=eq.${encodeURIComponent(reference)}&used_at=is.null`, { method: 'PATCH', body: { used_at: now.toISOString() } });
  await db('workshop_kit_codes', { method: 'POST', body: { reference, code_hash: sha(reference + ':' + code), expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString() } });
  return { status: 'sent', code };
}

// Returns { ok: true } or { ok: false, reason: 'expired' | 'wrong' | 'locked' | 'none' }.
export async function checkCode(reference, code, now = new Date()) {
  const rows = await db(`workshop_kit_codes?reference=eq.${encodeURIComponent(reference)}&used_at=is.null&select=id,code_hash,attempts,expires_at&order=created_at.desc&limit=1`);
  const row = rows[0];
  if (!row) return { ok: false, reason: 'none' };
  if (new Date(row.expires_at) <= now) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  const good = /^\d{6}$/.test(code) && same(row.code_hash, sha(reference + ':' + code));
  if (!good) {
    const attempts = row.attempts + 1;
    await db(`workshop_kit_codes?id=eq.${row.id}`, { method: 'PATCH', body: { attempts, ...(attempts >= MAX_ATTEMPTS ? { used_at: now.toISOString() } : {}) } });
    return { ok: false, reason: attempts >= MAX_ATTEMPTS ? 'locked' : 'wrong' };
  }
  await db(`workshop_kit_codes?id=eq.${row.id}`, { method: 'PATCH', body: { used_at: now.toISOString() } });
  return { ok: true };
}

export async function createSession(reference) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db('workshop_kit_sessions', { method: 'POST', body: { token_hash: sha(token), reference, expires_at: KIT_CLOSES.toISOString() } });
  return token;
}

export function readCookie(req, name = COOKIE) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export function sessionCookie(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${KIT_CLOSES.toUTCString()}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// The signed-in member for this request, or null.
export async function currentMember(req, now = new Date()) {
  if (!kitOpen(now)) return null;
  const token = readCookie(req);
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await db(`workshop_kit_sessions?token_hash=eq.${sha(token)}&select=reference,expires_at`);
  const s = rows[0];
  if (!s || new Date(s.expires_at) <= now) return null;
  const member = await findMember(s.reference);
  if (!member) return null;
  db(`workshop_kit_sessions?token_hash=eq.${sha(token)}`, { method: 'PATCH', body: { last_seen_at: now.toISOString() } }).catch(() => {});
  return member;
}

export async function endSession(req) {
  const token = readCookie(req);
  if (token) await db(`workshop_kit_sessions?token_hash=eq.${sha(token)}`, { method: 'DELETE' }).catch(() => {});
}

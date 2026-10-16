// Shared helpers for Netlify Functions — The Build Session.
// Persistence: Netlify Blobs (store "build-session", key "applicants.json").
// Same record schema as lib/store.js file backend. Secrets from env only.

import { getStore } from '@netlify/blobs';
import { classify, feeFor, CLASSIFICATIONS, RULES_VERSION } from '../../lib/classify.js';
import {
  applicantAcceptance, reviewRequired, futureCohort,
  paymentConfirmation, adminNotification, unpaidReminder,
} from '../../lib/emails.js';
import { createInviteSession, verifyWebhookEvent, paidSeats, inviteExpiry, inviteExpired, checkAccountCapability, MAX_SEATS } from '../../lib/payments.js';

export { classify, feeFor, CLASSIFICATIONS, RULES_VERSION, inviteExpiry, inviteExpired, checkAccountCapability };
export {
  applicantAcceptance, reviewRequired, futureCohort,
  paymentConfirmation, adminNotification, unpaidReminder,
};
export { createInviteSession, verifyWebhookEvent, paidSeats, MAX_SEATS };

const STORE_NAME = 'build-session';
const KEY = 'applicants.json';

async function readData() {
  const s = getStore({ name: STORE_NAME });
  const d = await s.get(KEY, { type: 'json' });
  if (!d) return { applicants: [], processedEvents: [], payments: [] };
  if (Array.isArray(d)) return { applicants: d, processedEvents: [], payments: [] };
  return { applicants: d.applicants || [], processedEvents: d.processedEvents || [], payments: d.payments || [] };
}
async function writeData(d) {
  const s = getStore({ name: STORE_NAME });
  await s.setJSON(KEY, d);
}

export const store = {
  async all() { return (await readData()).applicants; },
  async get(ref) { return (await readData()).applicants.find((a) => a.reference === ref); },
  async getByEmail(email) {
    return (await readData()).applicants.find((a) => a.email.toLowerCase() === String(email).toLowerCase());
  },
  async getBySession(sessionId) {
    return (await readData()).applicants.find((a) => a.invite && a.invite.sessionId === sessionId);
  },
  async insert(row) { const d = await readData(); d.applicants.push(row); await writeData(d); },
  async update(ref, patch) {
    const d = await readData();
    const i = d.applicants.findIndex((a) => a.reference === ref);
    if (i === -1) return null;
    d.applicants[i] = { ...d.applicants[i], ...patch };
    await writeData(d);
    return d.applicants[i];
  },
  async paidCount() { return (await readData()).applicants.filter((a) => a.status === 'paid').length; },
  async logPayment(entry) {
    const d = await readData();
    d.payments.push({ at: new Date().toISOString(), ...entry });
    await writeData(d);
  },
  async paymentHistory() { return (await readData()).payments; },
  async hasEvent(id) { return (await readData()).processedEvents.includes(id); },
  async markEvent(id) {
    const d = await readData();
    if (!d.processedEvents.includes(id)) { d.processedEvents.push(id); await writeData(d); }
  },
};

export const siteUrl = () => (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');
export const adminEmail = () => process.env.ADMIN_EMAIL || 'justin@motionplaylabs.com';

// Server-side Resend send. Never called from frontend. Never logs the key.
export async function sendMail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:console] to=${to} subject=${subject}`);
    return { via: 'console' };
  }
  const from = process.env.RESEND_FROM || 'MotionPlay Labs <hello@motionplaylabs.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error('Resend error ' + res.status + ': ' + (await res.text()).slice(0, 300));
  return { via: 'resend' };
}

export const json = (data, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export function requireAdmin(event) {
  const token = (event.headers && (event.headers['x-admin-token'] || event.headers['X-Admin-Token']))
    || event.queryStringParameters?.token;
  let bodyToken;
  try { bodyToken = event.body && JSON.parse(event.body)?.token; } catch { /* ignore */ }
  const t = token || bodyToken;
  if (!process.env.ADMIN_TOKEN || t !== process.env.ADMIN_TOKEN) return false;
  return true;
}

export function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
}
